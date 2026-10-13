from uuid import UUID, uuid4
from sqlalchemy import select
from test_inventory import accounts
from app.db.models import Server, ServerKind, ServerMember, MemberRole
from app.db.session import SessionLocal


def test_pins_are_personal_persistent_and_members_only(accounts):
    client, users = accounts
    alice, a, _ = users[1]
    bob, b, _ = users[2]
    outsider, _, _ = users[0]
    created = client.post('/api/conversations/group', headers=alice,
                          json={'name': 'Pin review', 'member_ids': [b['id']]})
    assert created.status_code == 201, created.text
    conversation = created.json()['id']
    url = f'/api/conversations/{conversation}/pin'
    try:
        assert not created.json()['pinned']
        assert client.put(url, json={'pinned': True}).status_code == 401
        assert client.put(url, headers=outsider, json={'pinned': True}).status_code == 404
        assert client.put(url, headers=alice, json={}).status_code == 422
        for _ in range(2):
            assert client.put(url, headers=alice, json={'pinned': True}).json() == {'pinned': True}
        def state(headers):
            return next(c['pinned'] for c in client.get('/api/conversations', headers=headers).json() if c['id'] == conversation)
        assert state(alice) is True
        assert state(bob) is False
        with SessionLocal() as db:
            member = db.scalar(select(ServerMember).where(ServerMember.server_id == UUID(conversation), ServerMember.user_id == UUID(a['id'])))
            assert member.conversation_pinned is True
        assert client.put(url, headers=bob, json={'pinned': True}).status_code == 200
        assert client.put(url, headers=alice, json={'pinned': False}).status_code == 200
        assert state(alice) is False and state(bob) is True
    finally:
        with SessionLocal() as db:
            db.delete(db.get(Server, UUID(conversation)))
            db.commit()


def test_platforms_cannot_be_pinned_as_conversations(accounts):
    client, users = accounts
    headers, user, _ = users[1]
    with SessionLocal() as db:
        server = Server(name='Platform pin review', slug='pin-' + str(uuid4()), kind=ServerKind.WORKSPACE, owner_id=UUID(user['id']))
        db.add(server)
        db.flush()
        server_id = server.id
        db.add(ServerMember(server_id=server_id, user_id=UUID(user['id']), role=MemberRole.OWNER))
        db.commit()
    try:
        assert client.put(f'/api/conversations/{server_id}/pin', headers=headers, json={'pinned': True}).status_code == 404
    finally:
        with SessionLocal() as db:
            db.delete(db.get(Server, server_id))
            db.commit()
