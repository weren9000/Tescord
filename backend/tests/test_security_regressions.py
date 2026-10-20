import asyncio
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import TokenError, create_access_token, decode_signed_token
from app.db.models import Message, OutboxEvent, ServerMember
from app.db.session import SessionLocal
from app.main import app
from app.services.event_access import allowed_event_user_ids
from app.services.message_outbox import dispatch_once
from test_auth_workspace import register_regular_user, get_current_user_profile, delete_user, delete_server


@pytest.fixture
def conversation(monkeypatch):
    import app.main as main
    async def paused_worker():
        await asyncio.Event().wait()
    monkeypatch.setattr(main, 'run_message_outbox', paused_worker)
    with TestClient(app) as client:
        a, pa = register_regular_user(client)
        b, pb = register_regular_user(client)
        outsider, pc = register_regular_user(client)
        profile = get_current_user_profile(client, b)
        request = client.post('/api/friends/requests', headers={'Authorization': f'Bearer {a}'}, json={'user_id': profile['id']})
        assert request.status_code == 201, request.text
        accepted = client.post(f"/api/friends/requests/{request.json()['id']}/accept", headers={'Authorization': f'Bearer {b}'})
        assert accepted.status_code == 200, accepted.text
        response = client.post('/api/conversations/direct', headers={'Authorization': f'Bearer {a}'}, json={'user_id': profile['id']})
        assert response.status_code == 201, response.text
        chat = response.json()
        try:
            yield client, a, b, outsider, chat
        finally:
            delete_server(chat['id'])
            for payload in (pa, pb, pc):
                delete_user(payload['email'])


def test_sessions_revoke_and_legacy_tokens_are_rejected(conversation):
    client, token, _, _, _ = conversation
    profile = get_current_user_profile(client, token)
    legacy = create_access_token(profile['id'], get_settings().secret_key, 60)
    assert client.get('/api/me', headers={'Authorization': f'Bearer {legacy}'}).status_code == 401
    assert client.post('/api/auth/logout', headers={'Authorization': f'Bearer {token}'}).status_code == 204
    assert client.get('/api/me', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_outsider_cannot_subscribe_and_revocation_filters_delivery(conversation):
    client, a, b, outsider, chat = conversation
    with client.websocket_connect('/api/events/ws') as ws:
        ws.send_json({'type': 'authenticate', 'token': outsider})
        assert ws.receive_json()['type'] == 'ready'
        ws.send_json({'type': 'subscribe_server', 'server_id': chat['id']})
        while (event := ws.receive_json())['type'] != 'error':
            assert event['type'] == 'presence_updated'
        assert event['detail'] == 'Access denied'
    user_id = get_current_user_profile(client, b)['id']
    assert allowed_event_user_ids(chat['id'], {user_id}, chat['primary_channel_id']) == {user_id}
    with SessionLocal() as db:
        member = db.scalar(select(ServerMember).where(ServerMember.server_id == UUID(chat['id']), ServerMember.user_id == UUID(user_id)))
        db.delete(member)
        db.commit()
    assert allowed_event_user_ids(chat['id'], {user_id}, chat['primary_channel_id']) == set()


def test_message_retry_is_idempotent_and_paginated_recovery_is_complete(conversation):
    client, token, _, _, chat = conversation
    path = f"/api/channels/{chat['primary_channel_id']}/messages"
    headers = {'Authorization': f'Bearer {token}'}
    nonce = str(uuid4())
    original = client.post(path, headers=headers, data={'content': 'one', 'client_message_id': nonce})
    assert original.status_code == 201, original.text
    retry = client.post(path, headers=headers, data={'content': 'one', 'client_message_id': nonce})
    assert retry.status_code == 201 and retry.json()['id'] == original.json()['id']
    assert client.post(path, headers=headers, data={'content': 'changed', 'client_message_id': nonce}).status_code == 409
    for i in range(8):
        assert client.post(path, headers=headers, data={'content': f'message {i}', 'client_message_id': str(uuid4())}).status_code == 201
    ids = []
    params = {'from': original.json()['id'], 'limit': 3}
    while True:
        response = client.get(path, headers=headers, params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        ids.extend(item['id'] for item in page['items'])
        if not page['has_newer']:
            break
        params = {'after': page['next_after'], 'limit': 3}
    assert len(ids) == len(set(ids)) == 9
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Message).where(Message.client_message_id == UUID(nonce))) == 1
        assert db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.message_id == UUID(original.json()['id']))) == 1


def test_outbox_recovers_claim_after_process_crash_without_redis(conversation):
    import subprocess
    import sys
    from datetime import datetime, timedelta, timezone

    client, token, _, _, chat = conversation
    response = client.post(
        f"/api/channels/{chat['primary_channel_id']}/messages",
        headers={'Authorization': f'Bearer {token}'},
        data={'content': 'survives worker restart', 'client_message_id': str(uuid4())},
    )
    assert response.status_code == 201
    message_id = UUID(response.json()['id'])
    # A separate process commits a lease, then exits without delivering or cleaning up.
    subprocess.run([sys.executable, '-c',
                    'from app.services.message_outbox import _claim; import os; _claim(); os._exit(0)'],
                   check=True, timeout=10)
    with SessionLocal() as db:
        event = db.scalar(select(OutboxEvent).where(OutboxEvent.message_id == message_id))
        assert event.delivered_at is None and event.attempts == 1
        # Advance the durable lease instead of making the test sleep for a minute.
        event.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    subprocess.run([sys.executable, '-c', '''
import asyncio
from app.services.message_outbox import run_message_outbox
async def main():
    try:
        await asyncio.wait_for(run_message_outbox(), 1)
    except TimeoutError:
        pass
asyncio.run(main())
'''], check=True, timeout=10)
    with SessionLocal() as db:
        event = db.scalar(select(OutboxEvent).where(OutboxEvent.message_id == message_id))
        assert event.delivered_at is not None and event.attempts == 2


@pytest.mark.parametrize('token', ['a.b.c', '☃.e.e', 'e30.e30.a', '.', 'x' * 9000])
def test_malformed_signed_tokens_are_controlled(token):
    with pytest.raises(TokenError):
        decode_signed_token(token, 'test')


def test_concurrent_registration_has_unique_public_ids():
    suffix = uuid4().hex[:8]
    def register(index):
        with TestClient(app, raise_server_exceptions=False) as client:
            return client.post('/api/auth/register', json={'email': f'concurrent-{suffix}-{index}@example.test', 'nick': f'concurrent-{suffix}-{index}', 'password': 'testpass123', 'password_confirmation': 'testpass123'})
    try:
        with ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(register, range(3)))
        assert [r.status_code for r in results] == [201, 201, 201]
        assert len({r.json()['user']['public_id'] for r in results}) == 3
    finally:
        for i in range(3):
            delete_user(f'concurrent-{suffix}-{i}@example.test')


def test_voice_tokens_cannot_bypass_mute_kick_or_revoked_session(conversation, monkeypatch):
    from datetime import datetime, timezone, timedelta
    from app.db.models import VoiceChannelAccess
    from app.services.voice_sfu import media_permission
    from livekit import api
    client, owner, guest, _, _ = conversation
    settings = get_settings()
    monkeypatch.setattr(settings, 'livekit_url', 'wss://voice.example.test')
    monkeypatch.setattr(settings, 'livekit_api_key', 'test-key')
    monkeypatch.setattr(settings, 'livekit_api_secret', 'test-secret-' * 5)
    owner_headers = {'Authorization': f'Bearer {owner}'}
    guest_headers = {'Authorization': f'Bearer {guest}'}
    user_id = get_current_user_profile(client, guest)['id']
    server = client.post('/api/servers', headers=owner_headers, json={'name': f'voice-test-{uuid4().hex[:6]}'}).json()
    try:
        channel = client.post(f"/api/servers/{server['id']}/channels", headers=owner_headers, json={'name': 'Private voice', 'type': 'voice'}).json()
        assert client.post(f"/api/servers/{server['id']}/members", headers=owner_headers, json={'user_id': user_id}).status_code == 200
        assert client.put(f"/api/voice/channels/{channel['id']}/access/{user_id}", headers=owner_headers, json={'role': 'resident'}).status_code == 200
        response = client.post(f"/api/voice/channels/{channel['id']}/sfu-token", headers=guest_headers)
        assert response.status_code == 200, response.text
        token = response.json()['token']
        claims = api.TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret).verify(token)
        assert client.get('/api/voice/authorize-sfu', headers={'X-Sfu-Token': token}).status_code == 204
        with SessionLocal() as db:
            access = db.scalar(select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id == UUID(channel['id']), VoiceChannelAccess.user_id == UUID(user_id)))
            access.owner_muted = True
            db.commit()
        assert client.get('/api/voice/authorize-sfu', headers={'X-Sfu-Token': token}).status_code == 403
        muted = client.post(f"/api/voice/channels/{channel['id']}/sfu-token", headers=guest_headers).json()['token']
        assert not api.TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret).verify(muted).video.can_publish
        assert client.get('/api/voice/authorize-sfu', headers={'X-Sfu-Token': muted}).status_code == 204
        with SessionLocal() as db:
            access = db.scalar(select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id == UUID(channel['id']), VoiceChannelAccess.user_id == UUID(user_id)))
            access.blocked_until = datetime.now(timezone.utc) + timedelta(minutes=5)
            db.commit()
        assert client.get('/api/voice/authorize-sfu', headers={'X-Sfu-Token': muted}).status_code == 403
        assert media_permission(channel['id'], user_id, claims.metadata, joining=False) is None
        assert client.post('/api/auth/logout', headers=guest_headers).status_code == 204
        assert media_permission(channel['id'], user_id, claims.metadata, joining=False) is None
    finally:
        delete_server(server['id'])


def test_rate_limit_rejects_excess_and_fails_closed(monkeypatch):
    from fastapi import HTTPException
    from app.services import rate_limits
    class Counter:
        count = 0
        def eval(self, *args):
            self.count += 1
            return self.count, 59
    counter = Counter()
    monkeypatch.setattr(get_settings(), 'rate_limits_enabled', True)
    monkeypatch.setattr(rate_limits, '_redis', lambda: counter)
    rate_limits.enforce_limit('test', 'identity', 1, 60)
    with pytest.raises(HTTPException) as error:
        rate_limits.enforce_limit('test', 'identity', 1, 60)
    assert error.value.status_code == 429 and error.value.headers['Retry-After'] == '59'
    monkeypatch.setattr(rate_limits, '_redis', lambda: None)
    with pytest.raises(HTTPException) as error:
        rate_limits.enforce_limit('test', 'identity', 1, 60)
    assert error.value.status_code == 503


def test_health_reports_database_failure(monkeypatch):
    from app.api.routes import health
    def fail():
        raise OSError('offline')
    monkeypatch.setattr(health.engine, 'connect', fail)
    client = TestClient(app)
    assert client.get('/api/health').status_code == 503


def test_unauthenticated_upload_is_rejected_before_reading_body():
    from app.api.dependencies.upload_admission import UploadAdmissionMiddleware
    async def run():
        sent = []
        async def forbidden_receive():
            pytest.fail('Unauthenticated body was read')
        async def forbidden_app(*args):
            pytest.fail('Unauthenticated upload reached the application')
        async def send(message):
            sent.append(message)
        await UploadAdmissionMiddleware(forbidden_app)({'type': 'http', 'headers': [(b'content-type', b'multipart/form-data; boundary=test')]}, forbidden_receive, send)
        assert sent[0]['status'] == 401
    asyncio.run(run())


def test_push_subscription_cap_preserves_existing_device_updates(conversation, monkeypatch):
    client, owner, *_ = conversation
    settings = get_settings()
    monkeypatch.setattr(settings, 'push_vapid_public_key', 'test-only')
    monkeypatch.setattr(settings, 'push_vapid_private_key_path', 'test-only')
    monkeypatch.setattr(settings, 'push_vapid_subject', 'mailto:test@example.test')
    headers = {'Authorization': f'Bearer {owner}'}
    prefix = f'https://fcm.googleapis.com/fcm/send/{uuid4().hex}'
    def subscribe(index):
        return client.post('/api/push/subscriptions', headers=headers, json={'endpoint': f'{prefix}-{index}', 'keys': {'p256dh': 'test', 'auth': 'test'}})
    for i in range(10):
        assert subscribe(i).status_code == 204
    assert subscribe(0).status_code == 204
    assert subscribe(10).status_code == 409


def test_channel_search_filters_membership_and_escapes_wildcards(conversation):
    client, owner, guest, outsider, _ = conversation
    headers = {'Authorization': f'Bearer {owner}'}
    needle = f'find%_{uuid4().hex[:8]}'
    server = client.post('/api/servers', headers=headers, json={'name': 'Search verification'}).json()
    try:
        channel = client.post(f"/api/servers/{server['id']}/channels", headers=headers, json={'name': needle, 'type': 'text'}).json()
        found = client.get('/api/search/channels', headers=headers, params={'query': needle}).json()
        assert [item['channel_id'] for item in found] == [channel['id']]
        assert client.get('/api/search/channels', headers={'Authorization': f'Bearer {outsider}'}, params={'query': needle}).json() == []
        assert client.get('/api/search/channels', headers=headers, params={'query': needle.replace('%_', 'xx')}).json() == []
    finally:
        delete_server(server['id'])


def test_push_endpoint_rejects_internal_and_untrusted_hosts():
    from pydantic import ValidationError
    from app.schemas.push import PushSubscriptionUpsertRequest
    for endpoint in ['http://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://localhost/x', 'https://user@fcm.googleapis.com/x']:
        with pytest.raises(ValidationError):
            PushSubscriptionUpsertRequest(endpoint=endpoint, keys={'p256dh': 'key', 'auth': 'auth'})


def test_upload_quota_does_not_leave_partial_message(conversation, monkeypatch):
    client, token, _, _, chat = conversation
    monkeypatch.setattr(get_settings(), 'max_message_upload_bytes', 4)
    nonce = uuid4()
    response = client.post(f"/api/channels/{chat['primary_channel_id']}/messages", headers={'Authorization': f'Bearer {token}'}, data={'client_message_id': str(nonce)}, files=[('files', ('a.txt', b'123')), ('files', ('b.txt', b'456'))])
    assert response.status_code == 413
    with SessionLocal() as db:
        assert db.scalar(select(Message.id).where(Message.client_message_id == nonce)) is None


def test_notification_failure_is_retried_without_duplicate_message(conversation, monkeypatch):
    from datetime import datetime, timezone, timedelta
    from app.services import app_events
    client, token, _, _, chat = conversation
    async def fail(*args):
        raise OSError('temporary delivery failure')
    monkeypatch.setattr(app_events, 'publish_message_created', fail)
    response = client.post(f"/api/channels/{chat['primary_channel_id']}/messages", headers={'Authorization': f'Bearer {token}'}, data={'content': 'Persist despite notification failure', 'client_message_id': str(uuid4())})
    assert response.status_code == 201
    message_id = UUID(response.json()['id'])
    asyncio.run(dispatch_once())
    with SessionLocal() as db:
        event = db.scalar(select(OutboxEvent).where(OutboxEvent.message_id == message_id))
        assert event.delivered_at is None and event.attempts == 1
        event.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    delivered = []
    async def success(server, message):
        delivered.append(message['id'])
    monkeypatch.setattr(app_events, 'publish_message_created', success)
    asyncio.run(dispatch_once())
    assert str(message_id) in delivered
    with SessionLocal() as db:
        event = db.scalar(select(OutboxEvent).where(OutboxEvent.message_id == message_id))
        assert event.delivered_at is not None and event.attempts == 2


def test_slow_websocket_does_not_delay_other_recipients():
    import time
    from starlette.websockets import WebSocketState
    from app.services.app_events import AppEventManager
    async def run():
        manager = AppEventManager()
        started = time.monotonic()
        received = []
        class Socket:
            application_state = WebSocketState.CONNECTED
            def __init__(self, slow=False):
                self.slow = slow
            async def send_json(self, payload):
                if self.slow:
                    await asyncio.sleep(10)
                received.append(time.monotonic() - started)
            async def close(self, **kwargs):
                pass
        users = [uuid4() for _ in range(50)]
        for i, user in enumerate(users):
            await manager.connect(Socket(slow=i == 0), user)
        await manager.send_to_users(users, {'type': 'test'})
        assert len(received) == 49
        assert max(received) < 1
        assert str(users[0]) not in manager._connections
    asyncio.run(run())
