from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from sqlalchemy import select
from app.db.models import User, Server, FriendRequest
from app.db.session import SessionLocal
from test_inventory import accounts


def link(client, headers, hours=24):
    response = client.post('/api/friends/invite-link', headers=headers, json={'hours': hours})
    assert response.status_code == 200, response.text
    return '/api/friends/invites/' + response.json()['code']


def test_link_auto_adds_without_confirmation_and_is_idempotent(accounts):
    c, users = accounts
    a, alice, _ = users[0]
    b, bob, _ = users[1]
    url = link(c, a)
    public = c.get(url)
    assert public.status_code == 200 and public.json()['state'] == 'login'
    assert alice['email'] not in public.text
    assert public.headers['cache-control'] == 'no-store'
    assert c.post(url).status_code == 401
    assert c.post(url, headers=a).json()['state'] == 'self'
    # GET, including authenticated previews, never establishes friendship.
    assert c.get(url, headers=b).json()['state'] == 'ready'
    assert c.get('/api/friends/requests', headers=a).json()['incoming'] == []
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: c.post(url, headers=b), range(3)))
    assert all(r.status_code == 200 for r in results)
    assert len({r.json()['server_id'] for r in results}) == 1
    assert all(r.json()['state'] == 'friends' for r in results)
    from app.api.routes.friend_space_invites import friend_ids
    with SessionLocal() as db:
        assert UUID(bob['id']) in friend_ids(db, UUID(alice['id']))
    assert c.get('/api/friends/requests', headers=a).json()['incoming'] == []
    notices = c.get('/api/friends/notices', headers=a).json()
    assert len(notices) == 1 and notices[0]['reason'] == 'link'
    assert notices[0]['user_id'] == bob['id']
    c.delete('/api/friends/notices/' + notices[0]['id'], headers=b)
    assert len(c.get('/api/friends/notices', headers=a).json()) == 1
    c.delete('/api/friends/notices/' + notices[0]['id'], headers=a)
    assert c.get('/api/friends/notices', headers=a).json() == []


def test_expiration_rotation_revocation_and_old_links(accounts):
    c, users = accounts
    a, alice, _ = users[0]
    b, _, _ = users[1]
    assert c.get('/api/friends/invites/' + alice['id']).status_code == 404
    for payload in ({}, {'hours': 0}, {'hours': 721}, {'hours': 1.5}):
        assert c.post('/api/friends/invite-link', headers=a, json=payload).status_code == 422
    first = link(c, a, 1)
    second = link(c, a, 168)
    assert c.post(first, headers=b).status_code == 404
    assert c.delete('/api/friends/invite-link', headers=a).status_code == 204
    assert c.post(second, headers=b).status_code == 404
    expired = link(c, a)
    # Expiration is checked again on POST, even after a successful preview.
    assert c.get(expired, headers=b).status_code == 200
    with SessionLocal() as db:
        db.get(User, UUID(alice['id'])).friend_invite_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert c.get(expired).status_code == 404
    assert c.post(expired, headers=b).status_code == 404


def test_blocking_and_pending_request_resolution(accounts):
    c, users = accounts
    a, alice, _ = users[0]
    b, bob, _ = users[1]
    url = link(c, a)
    sent = c.post('/api/friends/requests', headers=b, json={'user_id': alice['id']})
    assert sent.status_code == 201
    assert len(c.get('/api/friends/requests', headers=a).json()['incoming']) == 1
    assert c.post(url, headers=b).status_code == 200
    assert c.get('/api/friends/requests', headers=a).json()['incoming'] == []
    assert c.post('/api/friends/requests/' + sent.json()['id'] + '/accept', headers=a).status_code == 400
    assert c.post('/api/friends/' + bob['id'] + '/block', headers=a).status_code == 204
    assert c.post(url, headers=b).status_code == 404


def test_regular_request_requires_acceptance_and_supports_cancel(accounts):
    c, users = accounts
    a, alice, _ = users[0]
    b, bob, _ = users[1]
    payload = {'user_id': bob['id']}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: c.post('/api/friends/requests', headers=a, json=payload), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    request = next(r.json() for r in responses if r.status_code == 201)
    path = '/api/friends/requests/' + request['id']
    assert c.post(path + '/cancel', headers=b).status_code == 403
    assert c.post(path + '/cancel', headers=a).status_code == 204
    assert c.get('/api/friends/requests', headers=b).json()['incoming'] == []
    assert c.post('/api/friends/requests', headers=a, json=payload).status_code == 201
    assert c.get('/api/friends/notices', headers=a).json() == []
    assert c.post(path + '/accept', headers=b).status_code == 200
    assert c.get('/api/friends/notices', headers=a).json()[0]['reason'] == 'accepted'
