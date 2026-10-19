"""Shared signaling state and atomic, ordered delivery to process-local sockets.

WATCH protects state transitions; the state and its stream events commit together.
No network I/O is allowed inside a transition callback. A lost worker is detected
by its lease, not by whichever API process happens to serve an HTTP request.
"""
import asyncio
import json
import logging
import os
from functools import lru_cache
from time import time
from uuid import uuid4

from redis import Redis
from redis.exceptions import WatchError
from redis.retry import Retry
from redis.backoff import NoBackoff
from starlette.websockets import WebSocketState
from app.core.config import get_settings

log = logging.getLogger(__name__)
WORKER = uuid4().hex
PREFIX = f'kva:cluster:{get_settings().environment}:v1:'
STATE = PREFIX + 'signaling'
STREAM = PREFIX + 'events'
LEASE_SECONDS = 30
local_sockets = {}


def live_local_ids():
    # Also collect sockets whose route failed between accept and its finally block.
    for cid, ws in list(local_sockets.items()):
        if ws.application_state == WebSocketState.DISCONNECTED or ws.client_state == WebSocketState.DISCONNECTED:
            local_sockets.pop(cid, None)
    return set(local_sockets)


@lru_cache
def client():
    return Redis.from_url(get_settings().redis_url, decode_responses=True,
                          socket_timeout=2, socket_connect_timeout=2, max_connections=24,
                          retry=Retry(NoBackoff(), 0))


def read_state():
    return json.loads(client().get(STATE) or '{"connections":{},"calls":{},"rooms":{}}')


def transition(change):
    """Retry pure transitions; never repeat externally visible side effects."""
    for _ in range(100):
        with client().pipeline() as pipe:
            try:
                pipe.watch(STATE)
                state = json.loads(pipe.get(STATE) or '{"connections":{},"calls":{},"rooms":{}}')
                events = []
                result = change(state, events)
                pipe.multi()
                pipe.set(STATE, json.dumps(state, separators=(',', ':')))
                for event in events:
                    pipe.xadd(STREAM, {'data': json.dumps(event)}, maxlen=10000)
                pipe.execute()
                return result
            except WatchError:
                continue
    raise RuntimeError('Signaling contention; retry the operation')


async def mutate(change):
    return await asyncio.to_thread(transition, change)


def send(events, ids, payload=None, *, close=None):
    ids = list(ids)
    if ids:
        events.append({'ids': ids, 'payload': payload, 'close': close})


def user_connections(state, user_id, client_id=None, exclude_client_id=None):
    return [cid for cid, c in state['connections'].items()
            if c['user_id'] == user_id
            and (client_id is None or c['client_id'] == client_id)
            and (exclude_client_id is None or c['client_id'] != exclude_client_id)]


def end_call(state, events, call, detail):
    state['calls'].pop(call['id'], None)
    for uid in (call['caller_user_id'], call['callee_user_id']):
        send(events, user_connections(state, uid),
             {'type': 'call_ended', 'call_id': call['id'], 'detail': detail})


def sweep(local_ids=None):
    # Snapshot dead leases before WATCH. A worker UUID is never reused.
    state = read_state()
    workers = {c['worker'] for c in state['connections'].values()}
    workers.update(p['worker'] for room in state['rooms'].values() for p in room.values())
    dead = {w for w in workers if not client().exists(PREFIX + 'worker:' + w)}
    stale = {cid for cid, conn in state['connections'].items()
             if conn['worker'] in dead or (local_ids is not None and conn['worker'] == WORKER and cid not in local_ids)}
    stale.update(pid for room in state['rooms'].values() for pid, p in room.items()
                 if p['worker'] in dead or (local_ids is not None and p['worker'] == WORKER and pid not in local_ids))
    now = time()
    def change(state, events):
        for cid, c in list(state['connections'].items()):
            if cid in stale:
                del state['connections'][cid]
        for channel, room in list(state['rooms'].items()):
            for pid, p in list(room.items()):
                if pid in stale:
                    del room[pid]
                    send(events, room, {'type': 'peer_left', 'participant_id': pid})
                    events.append({'resync': True})
            if not room:
                del state['rooms'][channel]
        for call in list(state['calls'].values()):
            if call['status'] == 'ringing' and now >= call['expires_at']:
                end_call(state, events, call, 'Нет ответа')
                continue
            for uid, device in call['owners'].items():
                if user_connections(state, uid, device):
                    call['missing'].pop(uid, None)
                else:
                    deadline = call['missing'].setdefault(uid, now + 20)
                    if now >= deadline:
                        end_call(state, events, call, 'Собеседник отключился')
                        break
    transition(change)


async def close_local_sockets():
    sockets = list(local_sockets.values())
    await asyncio.gather(*(close_socket(ws) for ws in sockets), return_exceptions=True)


async def close_socket(ws, code=1012, reason='Signaling reconnect required'):
    async with asyncio.timeout(2):
        await ws.close(code=code, reason=reason)


async def deliver(event):
    if event.get('resync'):
        from app.services.app_events import app_event_manager
        await app_event_manager.broadcast({'type': 'resync_required'})
        return
    async def one(cid):
        ws = local_sockets.get(cid)
        if ws is None:
            return
        try:
            async with asyncio.timeout(2):
                if event.get('close'):
                    await ws.close(**event['close'])
                else:
                    await ws.send_json(event['payload'])
        except Exception:
            local_sockets.pop(cid, None)
            try:
                await close_socket(ws)
            except Exception:
                pass
    await asyncio.gather(*(one(cid) for cid in event['ids']))


async def start():
    if not get_settings().redis_url:
        return []
    await asyncio.to_thread(client().set, PREFIX + 'worker:' + WORKER, str(os.getpid()), ex=LEASE_SECONDS)
    tail = await asyncio.to_thread(client().xrevrange, STREAM, count=1)
    cursor = tail[0][0] if tail else '0-0'

    async def heartbeat():
        while True:
            try:
                if not await asyncio.to_thread(client().exists, PREFIX + 'worker:' + WORKER):
                    await close_local_sockets()
                await asyncio.to_thread(client().set, PREFIX + 'worker:' + WORKER, str(os.getpid()), ex=LEASE_SECONDS)
                await asyncio.to_thread(sweep, live_local_ids())
                await sync_subscriptions()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning('Cluster heartbeat unavailable pid=%s', os.getpid())
            await asyncio.sleep(5)

    async def listen():
        nonlocal cursor
        interrupted = False
        while True:
            try:
                rows = await asyncio.to_thread(client().xread, {STREAM: cursor}, count=100, block=500)
                if interrupted:
                    # Reconnect gets canonical state even if the bounded stream was trimmed.
                    await close_local_sockets()
                    interrupted = False
                for _, entries in rows:
                    for eid, fields in entries:
                        await deliver(json.loads(fields['data']))
                        cursor = eid
            except asyncio.CancelledError:
                raise
            except Exception:
                interrupted = True
                log.warning('Signaling stream interrupted pid=%s', os.getpid())
                await asyncio.sleep(1)
    return [asyncio.create_task(heartbeat()), asyncio.create_task(listen())]


async def sync_subscriptions():
    if not get_settings().redis_url:
        return
    from app.services.app_events import app_event_manager
    async with app_event_manager._lock:
        rows = [[uid, conn.active_server_id] for uid, connections in app_event_manager._connections.items()
                for conn in connections.values() if conn.active_server_id]
    await asyncio.to_thread(client().set, PREFIX+'subscriptions:'+WORKER, json.dumps(rows), ex=LEASE_SECONDS)


def active_subscribers(server_id):
    keys = list(client().scan_iter(PREFIX+'subscriptions:*'))
    if not keys:
        return set()
    return {uid for raw in client().mget(keys) if raw for uid, sid in json.loads(raw) if sid == str(server_id)}


async def stop(tasks):
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    # Do not delete the worker lease early: reconnecting clients get a grace period.
    local_sockets.clear()


async def singleton(name, run):
    """Renewable leader lease. Cancel work immediately if ownership is uncertain."""
    if not get_settings().redis_url:
        return await run()
    key = PREFIX + 'leader:' + name
    token = WORKER + ':' + uuid4().hex
    script = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) else return 0 end"
    task = None
    try:
        while True:
            try:
                if task is None:
                    if await asyncio.to_thread(client().set, key, token, nx=True, ex=15):
                        task = asyncio.create_task(run())
                elif task.done() or not await asyncio.to_thread(client().eval, script, 1, key, token, 15):
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                    task = None
            except Exception:
                if task:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                    task = None
                log.warning('Background leader unavailable: %s pid=%s', name, os.getpid())
            await asyncio.sleep(3)
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        try:
            await asyncio.to_thread(client().eval, "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, key, token)
        except Exception:
            pass
