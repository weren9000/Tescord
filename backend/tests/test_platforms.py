from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.db.models import Platform, PlatformMember, Server, ServerMember
from app.db.session import SessionLocal
from test_auth_workspace import register_regular_user, get_current_user_profile, delete_user


@pytest.fixture
def community():
    with TestClient(app) as client:
        users = [register_regular_user(client) for _ in range(4)]
        headers = [{"Authorization": "Bearer " + token} for token, _ in users]
        ids = [get_current_user_profile(client, token)["id"] for token, _ in users]
        response = client.post("/api/platforms", headers=headers[0], json={"name": "Community"})
        assert response.status_code == 201, response.text
        platform = response.json()
        yield client, headers, ids, platform
        with SessionLocal() as db:
            row = db.get(Platform, UUID(platform["id"]))
            if row:
                db.delete(row)
                db.commit()
        for _, payload in users:
            delete_user(payload["email"])


def join_member(client, headers, platform_id, index):
    invite = client.post(f"/api/platforms/{platform_id}/invites", headers=headers[0], json={})
    assert invite.status_code == 201, invite.text
    response = client.post("/api/platforms/join/" + invite.json()["token"], headers=headers[index])
    assert response.status_code == 200, response.text


def test_invitation_preview_does_not_join_or_consume_use(community):
    client, headers, ids, platform = community
    pid = platform['id']
    invitation = client.post(f'/api/platforms/{pid}/invites', headers=headers[0], json={'max_uses': 1}).json()
    url = '/api/platforms/invitation/' + invitation['token']
    assert client.get(url).status_code == 401
    preview = client.get(url, headers=headers[1])
    assert preview.status_code == 200
    assert preview.json() == {'name': 'Community', 'description': None, 'icon_url': None}
    assert preview.headers['cache-control'] == 'no-store'
    assert client.get('/api/platforms', headers=headers[1]).json() == []
    assert client.get(f'/api/platforms/{pid}/invites', headers=headers[0]).json()[0]['uses'] == 0
    assert client.post('/api/platforms/join/' + invitation['token'], headers=headers[1]).status_code == 200
    assert client.get(url, headers=headers[2]).status_code == 410
    revoked = client.post(f'/api/platforms/{pid}/invites', headers=headers[0], json={}).json()
    client.delete(f"/api/platforms/{pid}/invites/{revoked['id']}", headers=headers[0])
    assert client.get('/api/platforms/invitation/' + revoked['token'], headers=headers[2]).status_code == 410
    assert client.get('/api/platforms/invitation/' + 'x' * 43, headers=headers[2]).status_code == 404


def test_membership_all_chats_and_revocation(community):
    client, headers, ids, platform = community
    pid, first = platform["id"], platform["chat_id"]
    join_member(client, headers, pid, 1)
    added = client.post(f"/api/platforms/{pid}/chats", headers=headers[0], json={"name": "Second"})
    assert added.status_code == 201, added.text
    second = added.json()["id"]
    for chat_id in [first, second]:
        channels = client.get(f"/api/servers/{chat_id}/channels", headers=headers[1])
        assert channels.status_code == 200, channels.text
        assert {c["type"] for c in channels.json()} == {"text", "voice"}
        voice = next(c for c in channels.json() if c["type"] == "voice")
        assert voice["voice_access_role"] == "resident"
        assert client.get(f"/api/servers/{chat_id}/channels", headers=headers[2]).status_code == 404
        assert client.post(f"/api/servers/{chat_id}/leave", headers=headers[1], json={}).status_code == 409
        assert client.post(f"/api/servers/{chat_id}/invites", headers=headers[0], json={}).status_code == 409
    assert client.post(f"/api/platforms/{pid}/leave", headers=headers[1]).status_code == 204
    for chat_id in [first, second]:
        assert client.get(f"/api/servers/{chat_id}/channels", headers=headers[1]).status_code == 404
    with SessionLocal() as db:
        assert not db.scalars(select(ServerMember).where(ServerMember.user_id == UUID(ids[1]), ServerMember.server_id.in_([UUID(first), UUID(second)]))).all()


def test_role_hierarchy_transfer_and_default_chat(community):
    client, h, ids, p = community
    pid = p["id"]
    for i in [1, 2, 3]:
        join_member(client, h, pid, i)
    for i in [1, 2]:
        assert client.put(f"/api/platforms/{pid}/members/{ids[i]}/role", headers=h[0], json={"role": "admin"}).status_code == 204
    assert client.delete(f"/api/platforms/{pid}/members/{ids[2]}", headers=h[1]).status_code == 403
    assert client.delete(f"/api/platforms/{pid}/members/{ids[0]}", headers=h[1]).status_code == 403
    assert client.put(f"/api/platforms/{pid}/members/{ids[3]}/role", headers=h[1], json={"role": "admin"}).status_code == 403
    assert client.delete(f"/api/platforms/{pid}/members/{ids[3]}", headers=h[1]).status_code == 204
    assert client.post(f"/api/platforms/{pid}/leave", headers=h[0]).status_code == 409
    assert client.post(f"/api/platforms/{pid}/transfer", headers=h[0], json={"user_id": ids[1]}).status_code == 204
    with SessionLocal() as db:
        platform = db.get(Platform, UUID(pid))
        assert platform.owner_id == UUID(ids[1])
        members = db.scalars(select(PlatformMember).where(PlatformMember.platform_id == platform.id)).all()
        assert sum(m.role.value == "owner" for m in members) == 1
        chat = db.get(Server, UUID(p["chat_id"]))
        assert chat.owner_id == platform.owner_id
        assert chat.name == "Общий"


def test_join_and_chat_creation_are_serialized(community):
    client, h, ids, p = community
    pid = p["id"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        join = pool.submit(join_member, client, h, pid, 1)
        create = pool.submit(client.post, f"/api/platforms/{pid}/chats", headers=h[0], json={"name": "Concurrent"})
        join.result()
        response = create.result()
    assert response.status_code == 201, response.text
    assert client.get(f'/api/servers/{response.json()["id"]}/channels', headers=h[1]).status_code == 200


def test_legacy_cleanup_preserves_groups_users_and_new_platforms(community):
    from app.services.legacy_platform_cleanup import cleanup_plan, delete_legacy_workspaces
    from app.db.models import PlatformMigrationState, ServerKind, User
    client, h, ids, p = community
    legacy = client.post('/api/servers', headers=h[0], json={'name': 'Retired workspace'}).json()['id']
    group = client.post('/api/conversations/group', headers=h[0], json={'name': 'Independent', 'member_ids': []}).json()['id']
    with SessionLocal() as db:
        plan = cleanup_plan(db)
        assert legacy in plan['workspace_ids']
        assert group not in plan['workspace_ids']
        assert p['chat_id'] not in plan['workspace_ids']
        delete_legacy_workspaces(db, plan['workspace_ids'])
        assert db.get(PlatformMigrationState, 1) is not None
        from app.api.routes.servers import create_server
        from app.schemas.workspace import CreateServerRequest
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as rejected:
            create_server(CreateServerRequest(name='Old client'), db.get(User, UUID(ids[0])), db)
        assert rejected.value.status_code == 410
        assert db.get(Server, UUID(group)) is not None
        assert db.get(Platform, UUID(p['id'])) is not None
        assert db.get(User, UUID(ids[0])) is not None
        assert not db.scalars(select(Server).where(Server.kind == ServerKind.WORKSPACE)).all()
        db.rollback()  # Keep shared demo fixtures used by other tests intact.
        db.delete(db.get(Server, UUID(group)))
        db.delete(db.get(Server, UUID(legacy)))
        db.commit()


def test_search_moderation_and_voice_access_require_membership(community):
    client, h, ids, p = community
    pid, chat = p['id'], p['chat_id']
    join_member(client, h, pid, 1)
    channels = client.get(f'/api/servers/{chat}/channels', headers=h[0]).json()
    text = next(c['id'] for c in channels if c['type'] == 'text')
    voice = next(c['id'] for c in channels if c['type'] == 'voice')
    message = client.post(f'/api/channels/{text}/messages', headers=h[1], data={'content': 'searchable platform text'})
    assert message.status_code == 201, message.text
    mid = message.json()['id']
    results = client.get(f'/api/platforms/{pid}/search', headers=h[0], params={'query': 'searchable'})
    assert results.status_code == 200 and results.json()[0]['id'] == mid
    assert client.get(f'/api/platforms/{pid}/search', headers=h[2], params={'query': 'searchable'}).status_code == 404
    assert client.post(f'/api/voice/channels/{voice}/requests', headers=h[2]).status_code == 404
    assert client.delete(f'/api/platforms/{pid}/messages/{mid}', headers=h[2]).status_code == 404
    removed = client.delete(f'/api/platforms/{pid}/messages/{mid}', headers=h[0])
    assert removed.status_code == 204, removed.text
    assert client.get(f'/api/platforms/{pid}/search', headers=h[0], params={'query': 'searchable'}).json() == []
    assert client.get(f'/api/platforms/{pid}/voice-presence', headers=h[1]).status_code == 200


def test_platform_membership_is_not_limited_by_voice_capacity(community):
    from uuid import uuid4
    from app.db.models import User
    from app.services.platforms import add_member, platform_context
    client, h, ids, p = community
    created = []
    try:
        with SessionLocal() as db:
            platform, _ = platform_context(db, UUID(p['id']), UUID(ids[0]), lock=True)
            used = set(db.scalars(select(User.public_id)))
            available = iter(i for i in range(10000, 100000) if i not in used)
            for _ in range(35):
                name = 'capacity-' + uuid4().hex[:12]
                user = User(email=name+'@example.invalid', username=name, public_id=next(available), password_hash='unused-test-account')
                db.add(user)
                db.flush()
                created.append(user.id)
                add_member(db, platform, user)
            db.commit()
        assert len(client.get(f'/api/platforms/{p["id"]}/members', headers=h[0]).json()) == 36
        assert len(client.get(f'/api/servers/{p["chat_id"]}/members', headers=h[0]).json()) == 36
    finally:
        with SessionLocal() as db:
            for user in db.scalars(select(User).where(User.id.in_(created))):
                db.delete(user)
            db.commit()
