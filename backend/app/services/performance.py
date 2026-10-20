"""Bounded, process-local instrumentation. Never retains SQL, URLs or user data."""
import asyncio
from collections import defaultdict
import json
import os
import threading
import time
from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.pool import QueuePool

_lock = threading.Lock()
_values = defaultdict(lambda: [0, 0.0, 0.0])
_started = time.monotonic()
_request = ContextVar('performance_request', default=None)


def observe(name, value):
    with _lock:
        row = _values[name]
        row[0] += 1
        row[1] += value
        row[2] = max(row[2], value)


class MeasuredPool(QueuePool):
    def _do_get(self):
        started = time.monotonic()
        try:
            return super()._do_get()
        finally:
            # Includes opening a connection, not just waiting for a free slot.
            observe('db_acquire_ms', (time.monotonic() - started) * 1000)


def instrument(engine):
    @event.listens_for(engine, 'before_cursor_execute')
    def before(conn, cursor, statement, parameters, context, executemany):
        context._kva_started = time.monotonic()
        request = _request.get()
        if request is not None:
            with _lock:
                request['queries'] += 1

    @event.listens_for(engine, 'after_cursor_execute')
    def after(conn, cursor, statement, parameters, context, executemany):
        observe('sql_ms', (time.monotonic() - context._kva_started) * 1000)

    @event.listens_for(engine, 'handle_error')
    def error(context):
        execution = context.execution_context
        if execution is not None and hasattr(execution, '_kva_started'):
            observe('sql_ms', (time.monotonic() - execution._kva_started) * 1000)
            observe('sql_errors', 1)


def snapshot():
    global _started
    with _lock:
        now = time.monotonic()
        result = {'seconds': now - _started, 'at': time.time(), 'values': dict(_values)}
        _values.clear()
        _started = now
        return result


async def flush_metrics():
    from app.services.cluster import client, PREFIX
    from app.core.config import get_settings
    while True:
        await asyncio.sleep(15)
        if get_settings().redis_url:
            try:
                data = json.dumps(snapshot())
                await asyncio.to_thread(client().set, PREFIX + 'performance:' + str(os.getpid()), data, ex=45)
            except Exception:
                pass  # Observability must never interrupt the application.


def cluster_metrics():
    from app.services.cluster import client, PREFIX
    totals = defaultdict(lambda: [0, 0.0, 0.0])
    rates = defaultdict(float)
    for key in client().scan_iter(match=PREFIX + 'performance:*', count=100):
        raw = client().get(key)
        if not raw:
            continue
        data = json.loads(raw)
        if time.time() - data['at'] > 30:
            continue
        for name, (count, total, maximum) in data['values'].items():
            row = totals[name]
            row[0] += count
            row[1] += total
            row[2] = max(row[2], maximum)
            rates[name] += count / max(1, data['seconds'])
    return {name: {'count': row[0], 'sum': row[1], 'mean': row[1] / row[0], 'max': row[2], 'per_second': rates[name]}
            for name, row in totals.items() if row[0]}


class PerformanceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        started = time.monotonic()
        request = {'queries': 0}
        token = _request.set(request)
        status = 500

        async def measured_send(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
            await send(message)

        try:
            await self.app(scope, receive, measured_send)
        finally:
            duration = (time.monotonic() - started) * 1000
            observe('api_ms', duration)
            route = getattr(scope.get('route'), 'path', None)
            if route:
                # Route templates contain placeholders, never actual IDs or queries.
                label = scope['method'] + ' ' + route
                observe('route_ms:' + label, duration)
                observe('route_sql:' + label, request['queries'])
            if status >= 500:
                observe('api_errors', 1)
            _request.reset(token)
