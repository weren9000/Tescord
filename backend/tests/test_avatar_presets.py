import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.avatar_presets import AVATAR_PRESETS
from test_auth_workspace import register_regular_user, delete_user, TEST_PNG_BYTES


@pytest.fixture
def account():
    with TestClient(app) as client:
        token, form = register_regular_user(client)
        try:
            yield client, {'Authorization': f'Bearer {token}'}
        finally:
            delete_user(form['email'])


def test_default_avatar_is_persistent_and_public(account):
    client, headers = account
    first = client.get('/api/me', headers=headers).json()
    assert first['avatar_preset'] in AVATAR_PRESETS
    assert not first['has_uploaded_avatar']
    assert client.get('/api/me', headers=headers).json()['avatar_preset'] == first['avatar_preset']
    avatar = client.get(f"/api/users/{first['id']}/avatar")
    assert avatar.status_code == 200
    assert avatar.headers['content-type'] == 'image/webp'
    assert avatar.content == client.get('/api/avatar-presets/'+first['avatar_preset']).content
    for preset in AVATAR_PRESETS:
        assert client.get('/api/avatar-presets/'+preset).status_code == 200


def test_selection_upload_and_removal_restore_saved_preset(account):
    client, headers = account
    selected = client.put('/api/me/profile', headers=headers, data={'avatar_preset': 'owl'})
    assert selected.status_code == 200
    selected = selected.json()
    assert selected['avatar_preset'] == 'owl'
    assert selected['avatar_updated_at'] is not None
    url = f"/api/users/{selected['id']}/avatar"
    assert client.get(url).content == client.get('/api/avatar-presets/owl').content
    uploaded = client.put('/api/me/profile', headers=headers, files={'avatar': ('test.png', TEST_PNG_BYTES, 'image/png')})
    assert uploaded.status_code == 200
    assert uploaded.json()['has_uploaded_avatar']
    assert uploaded.json()['avatar_preset'] == 'owl'
    assert client.get(url).content == TEST_PNG_BYTES
    removed = client.put('/api/me/profile', headers=headers, data={'remove_avatar': 'true'})
    assert removed.status_code == 200
    assert not removed.json()['has_uploaded_avatar']
    assert removed.json()['avatar_updated_at'] != uploaded.json()['avatar_updated_at']
    assert client.get(url).content == client.get('/api/avatar-presets/owl').content
    client.put('/api/me/profile', headers=headers, files={'avatar': ('test.png', TEST_PNG_BYTES, 'image/png')})
    replaced = client.put('/api/me/profile', headers=headers, data={'avatar_preset': 'cat'})
    assert not replaced.json()['has_uploaded_avatar']
    assert client.get(url).content == client.get('/api/avatar-presets/cat').content


def test_invalid_or_conflicting_selection_does_not_change_profile(account):
    client, headers = account
    before = client.get('/api/me', headers=headers).json()
    for data in [{'avatar_preset': '../users'}, {'avatar_preset': 'dragon'}, {'avatar_preset': 'cat', 'remove_avatar': 'true'}]:
        assert client.put('/api/me/profile', headers=headers, data=data).status_code == 400
        assert client.get('/api/me', headers=headers).json() == before
    assert client.put('/api/me/profile', data={'avatar_preset': 'cat'}).status_code == 401
