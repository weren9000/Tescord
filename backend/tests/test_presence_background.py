from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.site_presence import SitePresenceManager, site_presence_manager
from test_auth_workspace import register_regular_user, get_current_user_profile, delete_user


def test_minute_heartbeats_and_three_minute_disconnect_grace():
    presence = SitePresenceManager()
    user = uuid4()
    for second in (0, 60, 120, 180, 240, 300):
        with patch('app.services.site_presence.monotonic', return_value=second):
            assert presence.mark_active(user) == (second == 0)
            assert presence.online_user_ids([user]) == {user}
            assert presence.collect_expired_user_ids() == []
    with patch('app.services.site_presence.monotonic', return_value=480):
        assert presence.online_user_ids([user]) == {user}
    with patch('app.services.site_presence.monotonic', return_value=481):
        assert presence.collect_expired_user_ids() == [user]
        assert not presence.online_user_ids([user])


def test_background_socket_and_second_device_keep_user_online():
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            user = UUID(get_current_user_profile(client, token)['id'])
            with client.websocket_connect('/api/events/ws?background=1') as background:
                background.send_json({'type': 'authenticate', 'token': token})
                assert background.receive_json()['type'] == 'ready'
                assert user in site_presence_manager.online_user_ids([user])
                with client.websocket_connect('/api/events/ws') as other:
                    other.send_json({'type': 'authenticate', 'token': token})
                    assert other.receive_json()['type'] == 'ready'
                # Closing another device must not set the remaining client offline.
                assert user in site_presence_manager.online_user_ids([user])
                with site_presence_manager._lock:
                    site_presence_manager._last_seen[user] -= 181
                background.send_json({'type': 'ping'})
                while background.receive_json()['type'] != 'pong':
                    pass
                assert user in site_presence_manager.online_user_ids([user])
        finally:
            delete_user(payload['email'])
