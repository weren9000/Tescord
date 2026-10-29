from fastapi.testclient import TestClient
from app.main import app
from test_inventory import accounts


def test_connections_are_private_persistent_and_idempotent(accounts):
    client, users = accounts
    alice, _, form = users[0]
    bob, _, _ = users[1]
    url = '/api/applications'
    connection = url + '/game-calendar'
    assert client.get(url).status_code == 401
    assert client.put(connection, json={'enabled': True}).status_code == 401
    response = client.get(url, headers=alice)
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.json()[0]['enabled'] is False
    for _ in range(2):
        response = client.put(connection, headers=alice, json={'enabled': True})
        assert response.status_code == 200
        assert response.json()['enabled'] is True
    assert client.get(url, headers=bob).json()[0]['enabled'] is False
    with TestClient(app) as another_device:
        login = another_device.post('/api/auth/login', json={
            'email': form['email'], 'password': form['password'],
        })
        headers = {'Authorization': 'Bearer ' + login.json()['access_token']}
        assert another_device.get(url, headers=headers).json()[0]['enabled'] is True
        assert another_device.put(connection, headers=headers, json={'enabled': False}).status_code == 200
    assert client.get(url, headers=alice).json()[0]['enabled'] is False


def test_connection_rejects_unknown_apps_and_invalid_payloads(accounts):
    client, users = accounts
    headers, _, _ = users[0]
    assert client.put('/api/applications/unknown', headers=headers, json={'enabled': True}).status_code == 404
    for body in ({'enabled': 'false'}, {'enabled': 1}, {}, {'enabled': True, 'user_id': users[1][1]['id']}):
        assert client.put('/api/applications/game-calendar', headers=headers, json=body).status_code == 422
    assert client.get('/api/applications', headers=headers).json()[0]['enabled'] is False
