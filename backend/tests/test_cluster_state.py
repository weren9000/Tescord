"""Real Redis transition tests, opt in using a disposable LOCAL Redis URL."""
import asyncio
import os
from time import time
from uuid import uuid4
from urllib.parse import urlsplit
import pytest
from redis import Redis
from app.services import cluster as c
from app.services.cluster_signaling import ClusterDirectCallSignalingManager, ClusterVoiceSignalingManager


@pytest.fixture
def shared(monkeypatch):
    url = os.environ.get('KVA_TEST_REDIS_URL')
    if not url:
        pytest.skip('Set KVA_TEST_REDIS_URL to an isolated local Redis')
    assert urlsplit(url).hostname in ('localhost', '127.0.0.1')
    redis = Redis.from_url(url, decode_responses=True)
    prefix = 'cluster-test:' + uuid4().hex + ':'
    monkeypatch.setattr(c, 'client', lambda: redis)
    monkeypatch.setattr(c, 'PREFIX', prefix)
    monkeypatch.setattr(c, 'STATE', prefix+'state')
    monkeypatch.setattr(c, 'STREAM', prefix+'events')
    redis.set(prefix+'worker:'+c.WORKER, 'alive', ex=30)
    try:
        yield redis
    finally:
        keys = list(redis.scan_iter(prefix+'*'))
        if keys:
            redis.delete(*keys)
        redis.close()


def seed_connections():
    def change(state, events):
        for cid, uid, device in [('a', 'alice', 'phone'), ('b', 'bob', 'phone'), ('b2', 'bob', 'desktop'), ('d', 'dave', 'phone')]:
            state['connections'][cid] = {'worker': c.WORKER, 'user_id': uid, 'client_id': device, 'peer': {'user_id': uid, 'nick': uid}}
    c.transition(change)


def test_concurrent_callers_cannot_reserve_the_same_person(shared):
    seed_connections()
    async def scenario():
        m = ClusterDirectCallSignalingManager()
        results = await asyncio.gather(m.request_call('alice', 'bob', 'a'), m.request_call('dave', 'bob', 'd'))
        assert sorted(results) == [False, True]
        assert len(c.read_state()['calls']) == 1
    asyncio.run(scenario())


def test_only_one_device_can_accept_and_authorize_media(shared):
    seed_connections()
    async def scenario():
        m = ClusterDirectCallSignalingManager()
        assert await m.request_call('alice', 'bob', 'a')
        call = next(iter(c.read_state()['calls']))
        results = await asyncio.gather(m.respond_to_call('bob', call, accept=True, connection_id='b'),
                                      m.respond_to_call('bob', call, accept=True, connection_id='b2'))
        assert sorted(results) == [False, True]
        assert sum(m.media_allowed(call, 'bob', device) for device in ('phone', 'desktop')) == 1
        assert not await m.hangup('dave', call)
    asyncio.run(scenario())


def test_shared_sweep_survives_original_worker_and_expires_ringing(shared):
    seed_connections()
    asyncio.run(ClusterDirectCallSignalingManager().request_call('alice', 'bob', 'a'))
    def expire(state, events):
        next(iter(state['calls'].values()))['expires_at'] = time()-1
    c.transition(expire)
    c.sweep()
    assert not c.read_state()['calls']
    assert shared.xlen(c.STREAM) >= 4


def test_live_device_prevents_false_disconnect_and_dead_worker_is_removed(shared):
    seed_connections()
    async def scenario():
        m = ClusterDirectCallSignalingManager()
        await m.request_call('alice', 'bob', 'a')
        call = next(iter(c.read_state()['calls']))
        await m.respond_to_call('bob', call, accept=True, connection_id='b')
        def mark(state, events):
            state['calls'][call]['missing']['bob'] = time()-1
            state['rooms']['room'] = {'stale': {'worker': 'dead-worker', 'participant': {'id': 'stale'}}}
        c.transition(mark)
        c.sweep()
        assert call in c.read_state()['calls']
        assert not c.read_state()['calls'][call]['missing']
        assert not c.read_state()['rooms']
    asyncio.run(scenario())


def test_voice_revocation_updates_shared_state_and_targets_remote_socket(shared):
    def seed(state, events):
        state['rooms']['room'] = {
            'one': {'worker': 'remote', 'participant': {'id': 'one', 'user_id': 'alice'}},
            'two': {'worker': c.WORKER, 'participant': {'id': 'two', 'user_id': 'bob'}}}
    c.transition(seed)
    asyncio.run(ClusterVoiceSignalingManager().disconnect_user_sessions('room', 'alice'))
    assert list(c.read_state()['rooms']['room']) == ['two']
    import json
    events = [json.loads(fields['data']) for _, fields in shared.xrange(c.STREAM)]
    assert any(event.get('close', {}).get('code') == 4003 and event['ids'] == ['one'] for event in events)


def test_socket_closed_during_initialization_is_collected(shared, monkeypatch):
    from types import SimpleNamespace
    from starlette.websockets import WebSocketState
    monkeypatch.setattr(c, 'local_sockets', {
        'closed': SimpleNamespace(application_state=WebSocketState.DISCONNECTED, client_state=WebSocketState.CONNECTED),
        'live': SimpleNamespace(application_state=WebSocketState.CONNECTED, client_state=WebSocketState.CONNECTED),
    })
    def seed(state, events):
        state['rooms']['room'] = {cid: {'worker': c.WORKER, 'participant': {'id': cid}} for cid in c.local_sockets}
    c.transition(seed)
    c.sweep(c.live_local_ids())
    assert list(c.read_state()['rooms']['room']) == ['live']
