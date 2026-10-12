"""Redis fan-out for application events across backend processes.

Database-backed message recovery remains the source of truth after disconnection.
The media/control signaling managers still require a single production worker.
"""
import asyncio
from contextvars import ContextVar
from functools import wraps
import json
import logging
from uuid import uuid4

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_local_delivery = ContextVar('local_event_delivery', default=False)
_origin = uuid4().hex
_handlers = {}
_client = None
CHANNEL = f'kva:app-events:{get_settings().environment}:v1'


def _json_default(value):
    if isinstance(value, (set, frozenset)):
        return list(value)
    return str(value)


def distributed_event(function):
    name = function.__name__
    _handlers[name] = function

    @wraps(function)
    async def publish(*args, **kwargs):
        if not _local_delivery.get() and _client is not None:
            await _client.publish(CHANNEL, json.dumps({'origin': _origin, 'name': name, 'args': args, 'kwargs': kwargs}, default=_json_default))
        token = _local_delivery.set(True)
        try:
            return await function(*args, **kwargs)
        finally:
            _local_delivery.reset(token)
    return publish


async def start_event_bus():
    global _client
    if not get_settings().redis_url:
        return None
    from redis.asyncio import Redis
    _client = Redis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=5, health_check_interval=20)
    pubsub = _client.pubsub()
    await pubsub.subscribe(CHANNEL)

    async def listen():
        resync_needed = False
        try:
            while True:
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
                    if resync_needed:
                        from app.services.app_events import app_event_manager
                        await app_event_manager.broadcast({'type': 'resync_required'})
                        resync_needed = False
                    if not message:
                        continue
                    payload = json.loads(message['data'])
                    if payload.get('origin') == _origin or payload.get('name') not in _handlers:
                        continue
                    token = _local_delivery.set(True)
                    try:
                        await _handlers[payload['name']](*payload['args'], **payload['kwargs'])
                    finally:
                        _local_delivery.reset(token)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    resync_needed = True
                    logger.warning('Event bus delivery interrupted; clients can recover from database')
                    await asyncio.sleep(1)
        finally:
            await pubsub.aclose()
    return asyncio.create_task(listen())


async def stop_event_bus(task):
    global _client
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    if _client is not None:
        await _client.aclose()
        _client = None
