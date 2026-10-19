"""Run against four isolated local API processes, never a production database.

TESCORD_DATABASE_URL must point at kva_fix*/test*. Start APIs on 8101..8104
with the same database and an isolated Redis. This deliberately uses real HTTP
and WebSocket connections, not TestClient or a mocked event bus.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import UUID, uuid4
from urllib.parse import urlsplit
import httpx
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
url = urlsplit(os.environ['TESCORD_DATABASE_URL'])
assert url.hostname in ('localhost', '127.0.0.1') and url.path.startswith(('/test', '/kva_fix'))
from app.db.session import SessionLocal
from app.db.models import User
from app.db.inventory import InventoryCatalog


async def receive(ws, kind):
    async with asyncio.timeout(10):
        while True:
            event = json.loads(await ws.recv())
            if event['type'] == kind:
                return event


async def main():
    clients = [httpx.AsyncClient(base_url=f'http://127.0.0.1:{p}', timeout=15) for p in range(8101, 8105)]
    sockets = []
    users = []
    key = 'cluster-test-' + uuid4().hex
    async def request(worker, method, path, user=None, **kwargs):
        response = await clients[worker].request(method, path, headers={'Authorization': 'Bearer '+users[user]['access_token']} if user is not None else {}, **kwargs)
        assert response.status_code < 300, (method, path, response.status_code, response.text)
        return response.json() if response.content else None
    async def ws(worker, path, user):
        conn = await websockets.connect(f'ws://127.0.0.1:{8101+worker}/api{path}')
        sockets.append(conn)
        await conn.send(json.dumps({'type': 'authenticate', 'token': users[user]['access_token']}))
        return conn
    try:
        pids = [(await cli.get('/api/health')).headers['x-kva-worker'] for cli in clients]
        assert len(set(pids)) == 4, pids
        print('Four distinct API processes:', pids, flush=True)
        for i in range(3):
            users.append(await request(i, 'POST', '/api/auth/register', json=dict(email=f'{key}-{i}@example.test', nick=f'cluster-{key[-8:]}-{i}', password='TestCluster123!', password_confirmation='TestCluster123!')))
        a, b, d = [u['user']['id'] for u in users]
        ea = await ws(0, '/events/ws', 0); await receive(ea, 'ready')
        eb = await ws(1, '/events/ws', 1); await receive(eb, 'ready')
        friend = await request(2, 'POST', '/api/friends/requests', 0, json={'user_id': b})
        await receive(eb, 'friend_requests_changed')
        await request(3, 'POST', '/api/friends/requests/'+friend['id']+'/accept', 1)
        await receive(ea, 'friend_requests_changed')
        print('Cross-process friend request and acceptance: OK', flush=True)
        link = await request(0, 'POST', '/api/friends/invite-link', 0, json={'hours': 1})
        joined = await request(1, 'POST', '/api/friends/invites/'+link['code'], 1)
        server = joined['server_id']
        channels = await request(2, 'GET', f'/api/servers/{server}/channels', 0)
        channel = next(ch['id'] for ch in channels if ch['type'] == 'text')
        for conn in (ea, eb):
            await conn.send(json.dumps({'type': 'subscribe_server', 'server_id': server}))
            await conn.send(json.dumps({'type': 'ping'})); await receive(conn, 'pong')
        message = await request(2, 'POST', f'/api/channels/{channel}/messages', 0, data={'content': 'Cluster delivery test', 'client_message_id': str(uuid4())})
        event = await receive(eb, 'message_created')
        assert event['message']['id'] == message['id']
        print('Message fan-out from a third process: OK', flush=True)
        await request(3, 'POST', '/api/presence/heartbeat', 0)
        friends = await request(1, 'GET', '/api/conversations/directory', 1)
        assert any(f['user_id'] == a and f['is_online'] for f in friends)
        print('Shared presence: OK', flush=True)
        ca = await ws(0, '/calls/ws?client_id=cluster-a', 0); await receive(ca, 'ready')
        cb = await ws(1, '/calls/ws?client_id=cluster-b', 1); await receive(cb, 'ready')
        cb2 = await ws(3, '/calls/ws?client_id=cluster-b-other', 1); await receive(cb2, 'ready')
        await ca.send(json.dumps({'type': 'call_request', 'transport': 'sfu', 'target_user_id': b}))
        ringing = await receive(ca, 'call_ringing'); incoming = await receive(cb, 'incoming_call')
        assert incoming['call_id'] == ringing['call_id']
        call = incoming['call_id']
        await cb.send(json.dumps({'type': 'call_response', 'transport': 'sfu', 'call_id': call, 'action': 'accept'}))
        await receive(ca, 'call_accepted'); await receive(cb, 'call_accepted'); await receive(cb2, 'call_ended')
        await ca.close()
        ca = await ws(2, '/calls/ws?client_id=cluster-a', 0)
        assert (await receive(ca, 'ready'))['call_id'] == call
        assert (await receive(ca, 'call_accepted'))['call_id'] == call
        await ca.send(json.dumps({'type': 'hangup', 'call_id': call}))
        await receive(cb, 'call_ended')
        print('Cross-process call, device ownership, reconnect and hangup: OK', flush=True)
        group = await request(0, 'POST', '/api/conversations/group', 0,
                              json={'name': key[:30], 'member_ids': [b]})
        channels = await request(2, 'GET', f"/api/servers/{group['id']}/channels", 0)
        voice = next(ch['id'] for ch in channels if ch['type'] == 'voice')
        va = await ws(0, f'/voice/channels/{voice}/ws', 0)
        sa = await receive(va, 'room_state')
        vb = await ws(1, f'/voice/channels/{voice}/ws', 1)
        sb = await receive(vb, 'room_state')
        assert any(p['id'] == sa['self_id'] for p in sb['participants'])
        assert (await receive(va, 'peer_joined'))['participant']['id'] == sb['self_id']
        await va.send(json.dumps({'type': 'mute_state', 'muted': True}))
        assert (await receive(vb, 'mute_state'))['muted'] is True
        snapshot = await request(3, 'GET', f"/api/servers/{group['id']}/voice-presence", 0)
        assert len(snapshot[0]['participants']) == 2
        await vb.close()
        assert (await receive(va, 'peer_left'))['participant_id'] == sb['self_id']
        print('Group voice room, mute, HTTP snapshot and leave across workers: OK', flush=True)
        with SessionLocal() as db:
            db.get(User, UUID(a)).is_admin = True
            db.get(User, UUID(b)).crystals = 250
            db.add(InventoryCatalog(id=key, name='Cluster Test', kind='avatar', builtin=True))
            db.commit()
        await request(0, 'PUT', '/api/shop/admin/offers/'+key, 0, json=dict(price=100, status='published', position=0, recommended=False, version=0))
        body = dict(request_id=str(uuid4()), catalog_id=key, expected_price=100, offer_version=1)
        purchases = await asyncio.gather(*(request(i, 'POST', '/api/shop/purchases', 1, json=body) for i in range(4)))
        assert len({p['item_id'] for p in purchases}) == 1
        assert sum(not p['replayed'] for p in purchases) == 1
        assert (await request(3, 'GET', '/api/wallet', 1))['crystals'] == 150
        item = purchases[0]['item_id']
        gift = dict(request_id=str(uuid4()), recipient_id=d)
        await asyncio.gather(*(request(i, 'POST', f'/api/inventory/items/{item}/gift', 1, json=gift) for i in range(4)))
        assert any(x['id'] == item for x in (await request(2, 'GET', '/api/inventory', 2))['items'])
        print('Purchase and gift retries across all four processes: OK', flush=True)
        if os.environ.get('KVA_CLUSTER_FAILURE_TEST') == '1':
            import psutil
            from redis import Redis
            await ca.send(json.dumps({'type': 'call_request', 'transport': 'sfu', 'target_user_id': b}))
            call = (await receive(cb, 'incoming_call'))['call_id']
            await cb.send(json.dumps({'type': 'call_response', 'transport': 'sfu', 'call_id': call, 'action': 'accept'}))
            await receive(ca, 'call_accepted'); await receive(cb, 'call_accepted')
            process = psutil.Process(int(pids[2]))
            assert 'uvicorn' in ' '.join(process.cmdline()) and '8103' in process.cmdline()
            process.kill()
            ca = await ws(3, '/calls/ws?client_id=cluster-a', 0)
            assert (await receive(ca, 'ready'))['call_id'] == call
            await receive(ca, 'call_accepted')
            print('Abrupt worker death: accepted call restored on a surviving worker', flush=True)
            # Pause ONLY the disposable local Redis, never production.
            redis = Redis(host='127.0.0.1', port=16379, socket_timeout=2)
            await asyncio.to_thread(redis.execute_command, 'CLIENT', 'PAUSE', 8000, 'ALL')
            response = await clients[0].post('/api/presence/heartbeat', headers={'Authorization': 'Bearer '+users[0]['access_token']})
            assert response.status_code == 503, (response.status_code, response.text)
            await asyncio.sleep(9)
            ca = await ws(0, '/calls/ws?client_id=cluster-a', 0)
            assert (await receive(ca, 'ready'))['call_id'] == call
            await receive(ca, 'call_accepted')
            await ca.send(json.dumps({'type': 'hangup', 'call_id': call}))
            await receive(ca, 'call_ended')
            print('Redis outage: explicit 503, state retained, call restored after recovery', flush=True)
    finally:
        await asyncio.gather(*(s.close() for s in sockets), return_exceptions=True)
        await asyncio.gather(*(cli.aclose() for cli in clients))
        # Test accounts stay identifiable for additional crash/recovery checks.
        # Run cleanup_cluster.py (or delete these users) only in the disposable DB.
        Path('cluster-fixture.json').write_text(json.dumps({'users': users, 'catalog_id': key}), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
