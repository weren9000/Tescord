from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.db.models import FriendSpaceInvite, ServerMember, MemberRole
from app.services.site_presence import SitePresenceManager
from test_auth_workspace import register_regular_user, get_current_user_profile, make_friends, delete_user, delete_server

def test_presence_reads_do_not_consume_offline_transition():
    presence = SitePresenceManager(ttl_seconds=60)
    user = uuid4()
    with patch('app.services.site_presence.monotonic', return_value=0):
        assert presence.mark_active(user)
    with patch('app.services.site_presence.monotonic', return_value=61):
        assert not presence.online_user_ids([user])
        assert presence.collect_expired_user_ids() == [user]
        assert presence.collect_expired_user_ids() == []

def test_friend_receives_presence_without_subscribing_to_same_chat():
    from app.services.site_presence import site_presence_manager
    with TestClient(app) as client:
        accounts = [register_regular_user(client) for _ in range(2)]
        try:
            a, b = [item[0] for item in accounts]
            make_friends(client, a, b)
            uid = get_current_user_profile(client, a)['id']
            with client.websocket_connect('/api/events/ws') as ws:
                ws.send_json({'type': 'authenticate', 'token': b})
                assert ws.receive_json()['type'] == 'ready'
                with site_presence_manager._lock:
                    site_presence_manager._last_seen.pop(UUID(uid), None)
                assert client.post('/api/presence/heartbeat', headers={'Authorization': 'Bearer ' + a}).status_code == 204
                event = ws.receive_json()
                assert event['type'] == 'presence_updated' and event['user_id'] == uid and event['is_online']
        finally:
            for _, payload in accounts: delete_user(payload['email'])

@pytest.mark.parametrize('kind', ['workspace', 'group_chat'])
def test_addressed_invitations_permissions_accept_reject_and_expiry(kind):
    with TestClient(app) as client:
        accounts = [register_regular_user(client) for _ in range(3)]
        tokens = [a[0] for a in accounts]
        headers = [{'Authorization': 'Bearer ' + token} for token in tokens]
        users = [get_current_user_profile(client, token) for token in tokens]
        server_id = None
        try:
            make_friends(client, tokens[0], tokens[1])
            endpoint = '/api/servers' if kind == 'workspace' else '/api/conversations/group'
            payload = {'name': 'Invite test ' + uuid4().hex[:8], 'member_user_ids': []}
            response = client.post(endpoint, headers=headers[0], json=payload)
            assert response.status_code == 201, response.text
            server_id = response.json()['id']
            route = f'/api/servers/{server_id}/friend-invites'
            assert client.get(route, headers=headers[1]).status_code in {403, 404}
            assert client.post(route, headers=headers[0], json={'user_ids': [users[2]['id']]}).status_code == 403
            assert client.post(route, headers=headers[0], json={'user_ids': [users[1]['id']]}).status_code == 201
            assert client.post(route, headers=headers[0], json={'user_ids': [users[1]['id']]}).status_code == 201
            inbox = client.get('/api/friend-space-invites', headers=headers[1]).json()
            assert len(inbox) == 1
            invite_id = inbox[0]['id']
            respond = f'/api/friend-space-invites/{invite_id}'
            assert client.post(respond + '/accept', headers=headers[2]).status_code == 404
            assert client.post(respond + '/reject', headers=headers[1]).status_code == 200
            assert client.post(respond + '/accept', headers=headers[1]).status_code == 410
            assert client.post(route, headers=headers[0], json={'user_ids': [users[1]['id']]}).status_code == 409
            with SessionLocal() as db:
                invite = db.get(FriendSpaceInvite, UUID(invite_id))
                invite.status = 'pending'
                invite.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
                db.commit()
            assert client.post(respond + '/accept', headers=headers[1]).status_code == 410
            assert client.post(route, headers=headers[0], json={'user_ids': [users[1]['id']]}).status_code == 201
            accepted = client.post(respond + '/accept', headers=headers[1])
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()['server_id'] == server_id
            assert client.get(f"/api/servers/{server_id}/channels", headers=headers[1]).status_code == 200
            candidates = client.get(route, headers=headers[0]).json()
            assert candidates[0]['state'] == 'member'
            assert client.get('/api/friend-space-invites', headers=headers[1]).json() == []
        finally:
            if server_id: delete_server(server_id)
            for _, payload in accounts: delete_user(payload['email'])
