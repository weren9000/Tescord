from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.db.models import ServerInvite, ServerMember, ServerBlock
from app.db.session import SessionLocal
from test_auth_workspace import register_regular_user, get_current_user_profile, delete_user, delete_server


@pytest.fixture
def setup_invites():
    with TestClient(app) as client:
        users = [register_regular_user(client) for _ in range(3)]
        servers = []
        def create(kind='workspace'):
            path = '/api/servers' if kind == 'workspace' else '/api/conversations/group'
            payload = {'name': 'Invite test'} if kind == 'workspace' else {'name': 'Invite test', 'member_ids': []}
            response = client.post(path, headers=auth(users[0][0]), json=payload)
            assert response.status_code == 201, response.text
            servers.append(response.json()['id'])
            return servers[-1]
        yield client, users, create
        for server in servers: delete_server(server)
        for _, payload in users: delete_user(payload['email'])


def auth(token): return {'Authorization': 'Bearer ' + token}


def invite(client, owner, server, **payload):
    response = client.post(f'/api/servers/{server}/invites', headers=auth(owner), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize('kind', ['workspace', 'group_chat'])
def test_invite_preview_join_retry_and_permissions(setup_invites, kind):
    client, users, create = setup_invites
    owner, member, outsider = [u[0] for u in users]
    server = create(kind)
    link = invite(client, owner, server, max_uses=1)
    path = '/api/invites/' + link['token']
    assert client.get(path).status_code == 200
    assert client.post(path+'/join').status_code == 401
    with SessionLocal() as db:
        stored = db.get(ServerInvite, UUID(link['id']))
        assert len(stored.token_hash) == 64 and link['token'] not in stored.token_hash
        assert stored.uses == 0
    first = client.post(path+'/join', headers=auth(member))
    assert first.status_code == 200, first.text
    assert first.json()['kind'] == kind and first.json()['joined']
    second = client.post(path+'/join', headers=auth(member))
    assert second.status_code == 200 and not second.json()['joined']
    assert second.json()['channel_id'] == first.json()['channel_id']
    assert client.post(path+'/join', headers=auth(outsider)).status_code == 410
    assert client.post(f'/api/servers/{server}/invites', headers=auth(member), json={}).status_code == 403
    assert client.get(f'/api/servers/{server}/invites', headers=auth(outsider)).status_code == 404
    assert client.delete(f"/api/servers/{server}/invites/{link['id']}", headers=auth(member)).status_code == 403
    rows = client.get(f'/api/servers/{server}/invites', headers=auth(owner)).json()
    assert rows[0]['uses'] == 1 and 'token' not in rows[0] and 'token_hash' not in rows[0]
    members = client.get(f'/api/servers/{server}/members', headers=auth(owner)).json()
    profile = get_current_user_profile(client, member)
    assert next(m for m in members if m['user_id'] == profile['id'])['role'] == 'member'


def test_expiry_revocation_block_and_validation(setup_invites):
    client, users, create = setup_invites
    owner, member, _ = [u[0] for u in users]
    server, other = create(), create()
    link = invite(client, owner, server)
    path = '/api/invites/' + link['token']
    assert client.delete(f"/api/servers/{other}/invites/{link['id']}", headers=auth(owner)).status_code == 404
    assert client.delete(f"/api/servers/{server}/invites/{link['id']}", headers=auth(owner)).status_code == 204
    assert client.get(path).status_code == 410
    assert client.post(path+'/join', headers=auth(member)).status_code == 410
    expired = invite(client, owner, server)
    with SessionLocal() as db:
        db.get(ServerInvite, UUID(expired['id'])).expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    assert client.post('/api/invites/'+expired['token']+'/join', headers=auth(member)).status_code == 410
    active = invite(client, owner, server, expires_in_days=None)
    profile = get_current_user_profile(client, member)
    with SessionLocal() as db:
        db.add(ServerBlock(server_id=UUID(server),user_id=UUID(profile['id'])))
        db.commit()
    assert client.post('/api/invites/'+active['token']+'/join', headers=auth(member)).status_code == 403
    assert client.get('/api/invites/not-a-real-code').status_code == 404
    assert client.post(f'/api/servers/{server}/invites',headers=auth(owner),json={'max_uses':0}).status_code == 422


def test_single_use_race_and_same_user_retry(setup_invites):
    client, users, create = setup_invites
    owner, a, b = [u[0] for u in users]
    server = create()
    link = invite(client, owner, server, max_uses=1)
    def join(token): return client.post('/api/invites/'+link['token']+'/join',headers=auth(token))
    with ThreadPoolExecutor(2) as pool: results = list(pool.map(join,[a,b]))
    assert sorted(r.status_code for r in results) == [200,410], [r.text for r in results]
    winner = a if results[0].status_code == 200 else b
    with ThreadPoolExecutor(2) as pool: retries = list(pool.map(join,[winner,winner]))
    assert all(r.status_code == 200 and not r.json()['joined'] for r in retries)
    with SessionLocal() as db: assert db.get(ServerInvite,UUID(link['id'])).uses == 1


def test_last_group_seat_serializes_different_invites_and_manual_add(setup_invites):
    client, users, create = setup_invites
    owner, a, b = [u[0] for u in users]
    server = create('group_chat')
    for _ in range(8):
        user = register_regular_user(client);users.append(user)
        uid = get_current_user_profile(client,user[0])['id']
        response = client.post(f'/api/servers/{server}/members',headers=auth(owner),json={'user_id':uid})
        assert response.status_code == 200, response.text
    link = invite(client, owner, server)
    link2 = invite(client, owner, server)
    uid = get_current_user_profile(client,b)['id']
    def action(index):
        if index == 0: return client.post('/api/invites/'+link['token']+'/join',headers=auth(a))
        if index == 1: return client.post('/api/invites/'+link2['token']+'/join',headers=auth(b))
        return client.post(f'/api/servers/{server}/members',headers=auth(owner),json={'user_id':uid})
    with ThreadPoolExecutor(3) as pool: results = list(pool.map(action,range(3)))
    assert any(r.status_code == 200 for r in results), [r.text for r in results]
    assert all(r.status_code in {200,400,409} for r in results), [r.text for r in results]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ServerMember).where(ServerMember.server_id==UUID(server))) == 10
