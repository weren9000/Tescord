"""Exercise private SFU admission with existing disposable localhost test accounts."""
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import websockets


async def main():
    fixture = json.loads(Path(os.environ['KVA_TEST_FIXTURE']).read_text(encoding='utf8'))
    users = fixture['users']
    sockets = []
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000') as http:
        async def connect(index, client_id):
            ws = await websockets.connect('ws://127.0.0.1:8000/api/calls/ws?client_id=' + client_id, origin='http://localhost:4200')
            sockets.append(ws)
            await ws.send(json.dumps({'type': 'authenticate', 'token': users[index]['h']['Authorization'].split(' ', 1)[1]}))
            assert json.loads(await ws.recv())['type'] == 'ready'
            return ws

        async def receive(ws, kind, timeout=5):
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout))
                if message['type'] == kind:
                    return message

        async def token(index, call_id, client_id):
            return await http.post(f'/api/calls/{call_id}/sfu-token', headers=users[index]['h'], json={'client_id': client_id})

        a_id, b_id, other_id = (uuid4().hex for _ in range(3))
        a, b, other = await connect(0, a_id), await connect(1, b_id), await connect(1, other_id)
        call_id = None
        try:
            await a.send(json.dumps({'type': 'call_request', 'target_user_id': users[1]['user']['id'], 'transport': 'sfu'}))
            call_id = (await receive(a, 'call_ringing'))['call_id']
            await receive(b, 'incoming_call'); await receive(other, 'incoming_call')
            assert (await token(0, call_id, a_id)).status_code == 403, 'Admission before acceptance'
            await b.send(json.dumps({'type': 'call_response', 'call_id': call_id, 'action': 'accept', 'transport': 'sfu'}))
            assert (await receive(a, 'call_accepted'))['transport'] == 'sfu'
            await receive(b, 'call_accepted')
            await receive(other, 'call_ended')
            assert (await token(1, call_id, other_id)).status_code == 403, 'Other device admitted'
            assert (await token(2, call_id, a_id)).status_code == 403, 'Third account admitted'
            ta, tb = await token(0, call_id, a_id), await token(1, call_id, b_id)
            assert ta.status_code == tb.status_code == 200, (ta.status_code, tb.status_code)
            assert ta.json()['room_name'] == tb.json()['room_name'] == 'direct-' + call_id
            admission = await http.get('/api/voice/authorize-sfu', headers={'X-SFU-Token': ta.json()['token']})
            assert admission.status_code == 204, 'Active-call admission rejected'
            await a.close()
            a = await connect(0, a_id)
            await receive(a, 'call_accepted')
            assert (await token(0, call_id, a_id)).status_code == 200, 'Reconnect lost call ownership'
            await a.send(json.dumps({'type': 'hangup', 'call_id': call_id}))
            await receive(b, 'call_ended')
            assert (await token(0, call_id, a_id)).status_code == 403, 'Ended call still issues tokens'
            admission = await http.get('/api/voice/authorize-sfu', headers={'X-SFU-Token': ta.json()['token']})
            assert admission.status_code == 403, 'Stale room token still admitted'
            print('PASS: acceptance required, two-account/device access, signed SFU admission, reconnect, stale-token denial')
            for mode in ('reject', 'cancel', 'timeout'):
                await a.send(json.dumps({'type': 'call_request', 'target_user_id': users[1]['user']['id'], 'transport': 'sfu'}))
                call_id = (await receive(a, 'call_ringing'))['call_id']
                await receive(b, 'incoming_call')
                if mode == 'reject':
                    await b.send(json.dumps({'type': 'call_response', 'call_id': call_id, 'action': 'reject'}))
                    await receive(a, 'call_rejected')
                elif mode == 'cancel':
                    await a.send(json.dumps({'type': 'hangup', 'call_id': call_id}))
                else:
                    print('Checking unanswered-call timeout...', flush=True)
                ended = await receive(b, 'call_ended', timeout=55)
                assert ended['call_id'] == call_id
                assert (await token(0, call_id, a_id)).status_code == 403
            print('PASS: reject, cancel, repeated calls and unanswered-call timeout')
        finally:
            if call_id and a.state.name == 'OPEN':
                await a.send(json.dumps({'type': 'hangup', 'call_id': call_id}))
            for ws in sockets:
                await ws.close()


asyncio.run(main())
