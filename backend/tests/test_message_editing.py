from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from app.main import app
from app.db.models import Message
from app.db.session import SessionLocal
from test_auth_workspace import (
    register_regular_user, delete_user, delete_server, get_current_user_profile,
    connect_app_events_websocket, receive_app_event,
)


def test_edit_author_permissions_conflicts_and_live_event(tmp_path, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), 'uploads_dir', str(tmp_path))
    with TestClient(app) as client:
        author, a = register_regular_user(client)
        member, b = register_regular_user(client)
        outsider, c = register_regular_user(client)
        headers = {'Authorization': f'Bearer {author}'}
        member_headers = {'Authorization': f'Bearer {member}'}
        group = client.post('/api/conversations/group', headers=headers, json={
            'name': 'Editing test', 'member_ids': [get_current_user_profile(client, member)['id']],
        })
        assert group.status_code == 201, group.text
        group = group.json()
        channel = group['primary_channel_id']
        try:
            response = client.post(f'/api/channels/{channel}/messages', headers=headers, data={'content': 'Original'})
            assert response.status_code == 201, response.text
            original = response.json()
            path = f"/api/messages/{original['id']}"
            assert client.put(path + '/reactions/heart', headers=member_headers).status_code == 200
            body = {'content': 'Edited', 'expected_edited_at': None}
            assert client.patch(path, headers=member_headers, json=body).status_code == 403
            assert client.patch(path, headers={'Authorization': f'Bearer {outsider}'}, json=body).status_code == 404
            assert client.patch(path, headers=headers, json={'content': ' ', 'expected_edited_at': None}).status_code == 422
            assert client.patch(path, headers=headers, json={'content': 'x' * 20001, 'expected_edited_at': None}).status_code == 422
            assert client.patch(path, headers=headers, json={'content': 'Original', 'expected_edited_at': None}).json()['edited_at'] is None

            with connect_app_events_websocket(client, member, group['id']) as socket:
                edited = client.patch(path, headers=headers, json=body)
                assert edited.status_code == 200, edited.text
                edited = edited.json()
                event = receive_app_event(socket, 'message_updated')
                assert event['message']['content'] == 'Edited'
                assert event['message']['edited_at'] == edited['edited_at']
                assert 'reactions' not in event['message'] and 'read_by' not in event['message']
            assert edited['created_at'] == original['created_at']
            assert edited['reactions'] == [{'code': 'heart', 'count': 1, 'reacted': False}]
            assert client.patch(path, headers=headers, json=body).json()['edited_at'] == edited['edited_at']
            conflict = client.patch(path, headers=headers, json={'content': 'Stale edit', 'expected_edited_at': None})
            assert conflict.status_code == 409
            assert conflict.json()['detail']['current']['content'] == 'Edited'
            accepted = client.patch(path, headers=headers, json={'content': 'Resolved', 'expected_edited_at': edited['edited_at']})
            assert accepted.status_code == 200
            rows = client.get(f'/api/channels/{channel}/messages', headers=member_headers).json()
            if isinstance(rows, dict): rows = rows['items']
            assert next(m for m in rows if m['id'] == original['id'])['content'] == 'Resolved'
            with SessionLocal() as db:
                message = db.get(Message, UUID(original['id']))
                message.deleted_at = datetime.now(timezone.utc)
                db.commit()
            assert client.patch(path, headers=headers, json={'content': 'Revive', 'expected_edited_at': accepted.json()['edited_at']}).status_code == 409

            attachment = client.post(f'/api/channels/{channel}/messages', headers=headers,
                data={'content': 'Caption'}, files={'files': ('note.txt', b'hello', 'text/plain')})
            assert attachment.status_code == 201, attachment.text
            attachment = attachment.json()
            empty = client.patch(f"/api/messages/{attachment['id']}", headers=headers,
                json={'content': '', 'expected_edited_at': None})
            assert empty.status_code == 200, empty.text
            assert empty.json()['attachments'] == attachment['attachments']
        finally:
            delete_server(group['id'])
            for user in (a, b, c): delete_user(user['email'])
