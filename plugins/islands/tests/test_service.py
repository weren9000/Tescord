import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from islands.api import Config, create_app
from islands.auth import verify_grant
from islands import engine as e
from islands.store import Store, canonical


def sign(key, claims):
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    payload = encode(canonical(claims).encode())
    return payload + '.' + encode(key.sign(payload.encode()))


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='islands-test-')
        self.path = Path(self.directory.name) / 'isolated.sqlite3'
        self.key = Ed25519PrivateKey.generate()
        self.config = Config(str(self.path), self.key.public_key(), ('http://testserver',))
        self.app = create_app(self.config)
        self.store = self.app.state.store
        self.now = 1800000000
        self.store.clock = lambda: self.now
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.users = [{'uid': str(uuid4()), 'nick': f'Игрок {i}'} for i in range(5)]
        self.tokens = [self.login(u) for u in self.users]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def claims(self, user):
        return {'iss': 'kvachat', 'aud': 'islands', 'sub': user['uid'], 'nick': user['nick'],
                'iat': self.now, 'exp': self.now + 60, 'jti': str(uuid4())}

    def login(self, user):
        result = self.client.post('/api/auth', json={'grant': sign(self.key, self.claims(user))})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['token']

    def headers(self, i=0):
        return {'Authorization': 'Bearer ' + self.tokens[i], 'Origin': 'http://testserver'}

    def create(self):
        response = self.client.post('/api/rooms', json={'request_id': str(uuid4())}, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def joined(self, count=3):
        room = self.create()
        for i in range(1, count):
            result = self.client.post('/api/rooms/join', json={'code': room['code']}, headers=self.headers(i))
            self.assertEqual(result.status_code, 200, result.text)
            room = result.json()
        return room

    def command(self, room, command, i=0, request_id=None):
        return self.client.post('/api/rooms/' + room['id'] + '/commands', headers=self.headers(i),
                                json={'request_id': request_id or str(uuid4()), 'version': room['version'], 'command': command})

    def test_grant_signature_audience_expiry_and_replay(self):
        claims = self.claims(self.users[0])
        grant = sign(self.key, claims)
        self.assertEqual(self.client.post('/api/auth', json={'grant': grant}).status_code, 200)
        self.assertEqual(self.client.post('/api/auth', json={'grant': grant}).status_code, 401)
        for change in ({'aud': 'chat'}, {'iss': 'attacker'}, {'exp': self.now}, {'exp': self.now+3600}, {'iat': self.now+30}, {'sub': []}):
            bad = {**claims, **change, 'jti': str(uuid4())}
            self.assertEqual(self.client.post('/api/auth', json={'grant': sign(self.key, bad)}).status_code, 401)
        foreign = Ed25519PrivateKey.generate()
        self.assertEqual(self.client.post('/api/auth', json={'grant': sign(foreign, claims)}).status_code, 401)
        self.assertEqual(self.client.post('/api/auth', json={'grant': grant, 'user_id': self.users[1]['uid']}).status_code, 422)

    def test_session_expiry_and_revocation(self):
        self.assertEqual(self.client.get('/api/rooms', headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.delete('/api/auth', headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.get('/api/rooms', headers=self.headers()).status_code, 401)
        self.now += 91
        self.assertEqual(self.client.get('/api/rooms', headers=self.headers(1)).status_code, 401)

    def test_proxy_prefix_routes_and_rate_limit(self):
        with TestClient(self.app, root_path='/plugins/islands') as client:
            self.assertEqual(client.get('/plugins/islands/play.html').status_code, 200)
            self.assertEqual(client.get('/plugins/islands/api/rooms', headers=self.headers()).status_code, 200)
            with patch('islands.api.Limiter.allow', return_value=False):
                self.assertEqual(client.get('/plugins/islands/api/config').status_code, 429)

    def test_action_limit_still_allows_unanimous_finish(self):
        room = self.joined()
        for i in range(3):
            room = self.command(room, {'type': 'ready', 'ready': True}, i).json()
        room = self.command(room, {'type': 'start'}).json()
        with self.store.connect(True) as db:
            db.execute('UPDATE rooms SET version=20000 WHERE id=?', (room['id'],))
        room['version'] = 20000
        self.assertEqual(self.command(room, {'type': 'pause'}).status_code, 429)
        for i in range(3):
            response = self.command(room, {'type': 'abandon_vote', 'vote': True}, i)
            self.assertEqual(response.status_code, 200, response.text)
            room = response.json()
        self.assertEqual(room['state']['status'], 'abandoned')

    def test_no_membership_enumeration_or_unsigned_identity(self):
        room = self.create()
        url = '/api/rooms/' + room['id']
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers=self.headers(1)).status_code, 404)
        self.assertEqual(self.command(room, {'type': 'ready', 'ready': True}, 1).status_code, 404)
        self.assertEqual(self.client.get('/api/rooms', headers=self.headers(1)).json(), [])
        self.assertEqual(self.client.post('/api/rooms/join', json={'code': '000000000000'}, headers=self.headers()).status_code, 404)

    def test_lobby_capacity_readiness_color_and_host(self):
        room = self.joined(4)
        self.assertEqual(self.client.post('/api/rooms/join', json={'code': room['code']}, headers=self.headers(4)).status_code, 404)
        self.assertEqual(self.command(room, {'type': 'start'}, 1).status_code, 400)
        self.assertEqual(self.command(room, {'type': 'start'}).status_code, 400)
        self.assertEqual(self.command(room, {'type': 'color', 'color': 'amethyst'}, 1).status_code, 400)
        for i in range(4):
            room = self.command(room, {'type': 'ready', 'ready': True}, i).json()
        room = self.command(room, {'type': 'start'}).json()
        self.assertEqual(room['state']['phase'], 'setup_settlement')
        self.assertEqual(len(room['state']['board']['tiles']), 19)
        self.assertEqual(self.client.post('/api/rooms/join', json={'code': room['code']}, headers=self.headers(4)).status_code, 404)

    def test_command_idempotency_and_content_conflict(self):
        room = self.create()
        request_id = str(uuid4())
        command = {'type': 'ready', 'ready': True}
        first = self.command(room, command, request_id=request_id).json()
        second = self.command(room, command, request_id=request_id).json()
        self.assertEqual(first['version'], second['version'])
        self.assertFalse(first['replayed']); self.assertTrue(second['replayed'])
        self.assertEqual(self.command(room, {'type': 'ready', 'ready': False}, request_id=request_id).status_code, 409)
        self.assertEqual(self.command(room, command).status_code, 409)
        self.assertEqual(self.store.get(room['id'], self.users[0]['uid'])['version'], 1)

    def test_creation_retries_and_active_room_limit(self):
        request = {'request_id': str(uuid4())}
        first = self.client.post('/api/rooms', json=request, headers=self.headers()).json()
        second = self.client.post('/api/rooms', json=request, headers=self.headers()).json()
        self.assertEqual(first['id'], second['id'])
        for _ in range(4):
            self.create()
        response = self.client.post('/api/rooms', json={'request_id': str(uuid4())}, headers=self.headers())
        self.assertEqual(response.status_code, 429)

    def test_racing_commands_only_commit_once(self):
        room = self.create()
        def action(ready):
            try:
                return self.store.command(room['id'], self.users[0], str(uuid4()), room['version'], {'type': 'ready', 'ready': ready})
            except e.RuleError as exc:
                return exc.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(action, (True, False)))
        self.assertEqual(sum(isinstance(x, dict) for x in outcomes), 1)
        self.assertIn('conflict', outcomes)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)

    def test_restart_restores_state_and_receipts(self):
        room = self.create()
        request_id = str(uuid4())
        first = self.command(room, {'type': 'ready', 'ready': True}, request_id=request_id).json()
        reopened = Store(self.path, clock=lambda: self.now)
        self.assertEqual(reopened.get(room['id'], self.users[0]['uid'])['state'], first['state'])
        replay = reopened.command(room['id'], self.users[0], request_id, 0, {'type': 'ready', 'ready': True})
        self.assertTrue(replay['replayed'])

    def test_leave_revokes_membership_and_transfers_host(self):
        room = self.joined()
        request_id = str(uuid4())
        for _ in range(2):
            result = self.command(room, {'type': 'leave'}, request_id=request_id)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json(), {'left': True})
        self.assertEqual(self.client.get('/api/rooms/' + room['id'], headers=self.headers()).status_code, 404)
        view = self.store.get(room['id'], self.users[1]['uid'])
        self.assertEqual(view['state']['host'], self.users[1]['uid'])

    def test_private_projection_through_http_and_websocket(self):
        room = self.joined()
        with self.store.connect(True) as db:
            row = db.execute('SELECT * FROM rooms WHERE id=?', (room['id'],)).fetchone()
            state = json.loads(row['state'])
            state['players'][1]['development'] = [{'id': 'very-secret-card', 'kind': 'victory', 'bought_turn': 0}]
            e.transfer(state['bank'], state['players'][1]['hand'], {'ore': 3})
            db.execute('UPDATE rooms SET state=? WHERE id=?', (canonical(state), room['id']))
        view = self.client.get('/api/rooms/' + room['id'], headers=self.headers()).json()
        self.assertNotIn('very-secret-card', json.dumps(view))
        self.assertNotIn('hand', view['state']['players'][1])
        self.assertEqual(view['state']['players'][1]['resource_count'], 3)
        with self.client.websocket_connect('/api/rooms/' + room['id'] + '/stream', headers={'Origin': 'http://testserver'}) as socket:
            socket.send_json({'type': 'authenticate', 'token': self.tokens[0]})
            message = socket.receive_json()
            self.assertEqual(message['room']['state'], view['state'])
            self.assertNotIn('very-secret-card', json.dumps(message))
            updated = self.command(room, {'type': 'ready', 'ready': True}).json()
            message = socket.receive_json()
            self.assertEqual(message['room']['version'], updated['version'])

    def test_websocket_origin_membership_and_identity_renewal(self):
        room = self.create()
        url = '/api/rooms/' + room['id'] + '/stream'
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(url, headers={'Origin': 'https://evil.example'}):
                pass
        for token in (self.tokens[1], 'not-a-token'):
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect(url, headers={'Origin': 'http://testserver'}) as socket:
                    socket.send_json({'type': 'authenticate', 'token': token})
                    socket.receive_json()
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(url, headers={'Origin': 'http://testserver'}) as socket:
                socket.send_json({'type': 'authenticate', 'token': self.tokens[0]})
                socket.receive_json()
                socket.send_json({'type': 'authenticate', 'token': self.tokens[1]})
                socket.receive_json()

    def test_invalid_payloads_are_rejected_without_state_changes(self):
        room = self.create()
        invalid = [{'type': 'ready', 'ready': 1}, {'type': 'build', 'kind': ['city'], 'target': '0'},
                   {'type': 'start', 'dice': [6, 6]}, {'type': 'trade_offer', 'give': {'ore': -1}, 'want': {'wood': 1}},
                   {'type': 'discard', 'resources': {'ore': True}}, {'type': ['start']}, {'type': 'start', 'actor': self.users[1]['uid']}]
        for command in invalid:
            response = self.command(room, command)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.store.get(room['id'], self.users[0]['uid'])['version'], 0)
        response = self.client.post('/api/auth', content=b'x' * 9000)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get('/api/rooms', headers={**self.headers(), 'Origin': 'https://evil.example'}).status_code, 403)

    def test_failed_rules_are_atomic(self):
        room = self.joined()
        before = self.store.get(room['id'], self.users[0]['uid'])
        self.assertEqual(self.command(room, {'type': 'start'}).status_code, 400)
        after = self.store.get(room['id'], self.users[0]['uid'])
        self.assertEqual(before, after)

    def test_retention_keeps_active_rooms(self):
        active = self.create()
        closed = self.create()
        self.command(closed, {'type': 'leave'})
        self.now += 31 * 86400
        self.assertEqual(self.store.prune(), 1)
        self.assertEqual(self.store.get(active['id'], self.users[0]['uid'])['state']['status'], 'lobby')


if __name__ == '__main__':
    unittest.main()
