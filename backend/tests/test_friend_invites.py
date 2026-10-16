from uuid import uuid4
from test_inventory import accounts


def test_invitation_preview_and_explicit_request(accounts):
    client, users = accounts
    a, alice, _ = users[0]
    b, bob, _ = users[1]
    url = '/api/friends/invites/' + alice['id']
    public = client.get(url)
    assert public.status_code == 200
    assert set(public.json()) == {'nick', 'state'}
    assert public.json()['state'] == 'login'
    assert alice['email'] not in public.text
    assert public.headers['cache-control'] == 'no-store'
    assert client.post(url).status_code == 401
    assert client.get(url, headers=a).json()['state'] == 'self'
    assert client.get(url, headers=b).json()['state'] == 'ready'
    assert client.get(url, headers=b).json()['state'] == 'ready'
    sent = client.post(url, headers=b)
    assert sent.status_code == 200 and sent.json()['state'] == 'outgoing'
    assert alice['email'] not in sent.text
    assert client.post(url, headers=b).json()['state'] == 'outgoing'
    assert client.get('/api/friends/invites/' + bob['id'], headers=a).json()['state'] == 'incoming'
    requests = client.get('/api/friends/requests', headers=a).json()
    incoming = requests['incoming']
    matches = [entry for entry in incoming if entry['user']['user_id'] == bob['id']]
    assert len(matches) == 1
    assert client.post('/api/friends/requests/' + matches[0]['id'] + '/accept', headers=a).status_code == 200
    assert client.get(url, headers=b).json()['state'] == 'friends'
    assert client.post(url, headers=b).json()['state'] == 'friends'


def test_unavailable_and_blocked_invitation(accounts):
    client, users = accounts
    a, alice, _ = users[0]
    b, bob, _ = users[1]
    assert client.get('/api/friends/invites/' + str(uuid4())).status_code == 404
    assert client.get('/api/friends/invites/invalid').status_code == 422
    assert client.post('/api/friends/' + bob['id'] + '/block', headers=a).status_code == 204
    url = '/api/friends/invites/' + alice['id']
    assert client.get(url, headers=b).status_code == 404
    assert client.post(url, headers=b).status_code == 404
