import asyncio
import json
from unittest.mock import AsyncMock
import httpx
from fastapi import FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
from app.services import message_outbox, performance, resource_events


def test_sql_instrumentation_counts_errors_and_does_not_retain_statements():
    engine = create_engine('sqlite://', poolclass=performance.MeasuredPool)
    performance.instrument(engine)
    performance.snapshot()
    with engine.connect() as connection:
        connection.execute(text("select 'private-data'"))
        try:
            connection.execute(text('select missing_private_column'))
        except Exception:
            pass
    result = performance.snapshot()
    assert result['values']['sql_ms'][0] == 2
    assert result['values']['sql_errors'][0] == 1
    assert 'private' not in json.dumps(result)
    engine.dispose()


def test_outbox_wakes_immediately_and_drains_batches(monkeypatch):
    async def check():
        calls = 0
        waiting = asyncio.Event()
        delivered = asyncio.Event()
        async def dispatch():
            nonlocal calls
            calls += 1
            if calls == 1:
                waiting.set()
                return 0
            if calls == 2:
                return 20
            delivered.set()
            return 0
        monkeypatch.setattr(message_outbox, 'dispatch_once', dispatch)
        task = asyncio.create_task(message_outbox.run_message_outbox())
        try:
            await waiting.wait()
            await message_outbox.notify_outbox()
            await asyncio.wait_for(delivered.wait(), .5)
            assert calls == 3
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(check())


def test_outbox_local_wake_survives_redis_failure(monkeypatch):
    async def check():
        wake = asyncio.Event()
        monkeypatch.setattr(message_outbox, '_wake', wake)
        monkeypatch.setattr(message_outbox, 'wake_outbox', AsyncMock(side_effect=OSError('offline')))
        await message_outbox.notify_outbox()
        assert wake.is_set()
    asyncio.run(check())


def test_outbox_fallback_recovers_lost_wake(monkeypatch):
    async def check():
        calls = 0
        recovered = asyncio.Event()
        async def dispatch():
            nonlocal calls
            calls += 1
            if calls == 2:
                recovered.set()
            return 0
        monkeypatch.setattr(message_outbox, 'dispatch_once', dispatch)
        task = asyncio.create_task(message_outbox.run_message_outbox())
        try:
            await asyncio.wait_for(recovered.wait(), 6)
            assert calls == 2
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(check())


def test_resource_invalidation_only_for_successful_relevant_mutations(monkeypatch):
    async def check():
        publish = AsyncMock()
        monkeypatch.setattr(resource_events, 'resources_changed', publish)
        app = FastAPI()
        @app.post('/api/admin/wallets/{user_id}')
        def change(user_id: str): return {'ok': True}
        @app.get('/api/wallet')
        def read(): return {}
        @app.post('/api/messages')
        def message(): return {}
        app.add_middleware(resource_events.ResourceEventsMiddleware)
        app.add_middleware(performance.PerformanceMiddleware)
        performance.snapshot()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://testserver') as client:
            await client.get('/api/wallet')
            await client.post('/api/messages')
            await client.post('/api/admin/wallets/private-user-id')
        assert publish.await_count == 1
        data = performance.snapshot()
        assert data['values']['api_ms'][0] == 3
        assert 'private-user-id' not in json.dumps(data)
        assert 'route_ms:POST /api/admin/wallets/{user_id}' in data['values']
    asyncio.run(check())


def test_thumbnail_revalidation_does_not_regenerate(tmp_path, monkeypatch):
    from io import BytesIO
    from PIL import Image
    from starlette.requests import Request
    from app.services import image_previews
    monkeypatch.setattr(image_previews, '_uploads_root', lambda: tmp_path)
    data = BytesIO()
    Image.new('RGB', (128, 128), 'red').save(data, 'PNG')
    response = image_previews.small_preview_response(data.getvalue())
    request = Request({'type': 'http', 'headers': [(b'if-none-match', response.headers['etag'].encode())]})
    monkeypatch.setattr(image_previews.Image, 'open', lambda *a: (_ for _ in ()).throw(AssertionError('decoded cached image')))
    assert image_previews.small_preview_response(data.getvalue(), request).status_code == 304


def test_cpu_separates_application_steal_and_io(monkeypatch):
    from collections import namedtuple
    from app.services import monitoring
    Cpu = namedtuple('Cpu', 'user system idle iowait steal guest guest_nice')
    samples = iter([Cpu(1000,1000,5000,100,1000,0,0), Cpu(1030,1000,5040,110,1020,0,0)])
    app = iter([{42:100.0}, {42:110.0}])
    monkeypatch.setattr(monitoring.psutil, 'cpu_times', lambda: next(samples))
    monkeypatch.setattr(monitoring, 'backend_cpu_seconds', lambda: next(app))
    first, previous = monitoring.host_sample(None)
    second, _ = monitoring.host_sample(previous)
    assert first['backend_cpu_percent'] is None
    assert second['backend_cpu_percent'] == 10
    assert second['cpu_steal_percent'] == 20
    assert second['cpu_iowait_percent'] == 10
