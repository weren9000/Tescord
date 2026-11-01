import base64
import hashlib
import hmac
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings, get_settings
from app.services import turn_credentials, direct_call_sfu
from test_meeting_rooms import meeting, join, auth


@pytest.fixture
def configured_turn(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, 'turn_urls', ['turn:relay.example.test:3478?transport=udp'])
    monkeypatch.setattr(settings, 'turn_shared_secret', SecretStr('test-only-shared-secret-' * 3))
    monkeypatch.setattr(settings, 'turn_credential_ttl_seconds', 3600)
    return settings


def test_turn_credentials_expire_and_match_coturn_protocol(configured_turn, monkeypatch):
    monkeypatch.setattr(turn_credentials.time, 'time', lambda: 1800000000)
    server = turn_credentials.turn_ice_servers('user:test-user')[0]
    expiry, opaque = server['username'].split(':')
    assert int(expiry) == 1800003600 and len(opaque) == 32
    assert 'test-user' not in server['username']
    expected = base64.b64encode(hmac.new(configured_turn.turn_shared_secret.get_secret_value().encode(),
                                       server['username'].encode(), hashlib.sha1).digest()).decode()
    assert server['credential'] == expected
    assert server['username'] != turn_credentials.turn_ice_servers('meeting:test-guest')[0]['username']
    monkeypatch.setattr(turn_credentials.time, 'time', lambda: 1800000001)
    assert server['credential'] != turn_credentials.turn_ice_servers('user:test-user')[0]['credential']


def test_unconfigured_turn_leaves_livekit_ice_configuration_intact(monkeypatch):
    monkeypatch.setattr(turn_credentials, 'get_settings', lambda: Settings(_env_file=None))
    assert turn_credentials.turn_ice_servers('user:test') == []


@pytest.mark.parametrize('kwargs', [
    {'turn_urls': ['turn:relay.example.test']},
    {'turn_shared_secret': 'a' * 40},
    {'turn_urls': ['turn:relay.example.test'], 'turn_shared_secret': 'short'},
    {'turn_urls': ['https://relay.example.test'], 'turn_shared_secret': 'a' * 40},
])
def test_incomplete_or_unsafe_turn_configuration_is_rejected(kwargs):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **kwargs)


def test_guest_receives_turn_only_after_admission_and_not_after_kick(meeting, configured_turn, monkeypatch):
    monkeypatch.setattr('app.services.voice_sfu.enforce_participant', AsyncMock())
    c, _, ticket = meeting
    guest = join(c, ticket).json()
    monkeypatch.setattr(configured_turn, 'livekit_url', 'wss://media.example.test')
    monkeypatch.setattr(configured_turn, 'livekit_api_key', 'test-api-key')
    monkeypatch.setattr(configured_turn, 'livekit_api_secret', 'test-api-secret-' * 4)
    issued = c.post('/api/rooms/media', headers=auth(guest['token']))
    assert issued.status_code == 200, issued.text
    assert issued.json()['ice_servers'][0]['credential']
    assert issued.headers['cache-control'] == 'no-store'
    assert configured_turn.turn_shared_secret.get_secret_value() not in issued.text
    assert c.post('/api/rooms/media').status_code in {401, 422}
    control = c.post('/api/rooms/control', headers=auth(ticket['token']),
                     json={'action': 'kick', 'participant_id': guest['participant_id']})
    assert control.status_code == 200
    assert c.post('/api/rooms/media', headers=auth(guest['token'])).status_code == 403
    monkeypatch.setattr(configured_turn, 'livekit_url', None)


def test_direct_turn_is_not_issued_for_unaccepted_or_ended_calls(configured_turn, monkeypatch):
    import asyncio
    from fastapi import HTTPException
    monkeypatch.setattr(configured_turn, 'livekit_url', 'wss://media.example.test')
    monkeypatch.setattr(configured_turn, 'livekit_api_key', 'test-api-key')
    monkeypatch.setattr(configured_turn, 'livekit_api_secret', 'test-api-secret-' * 4)
    calls = []
    monkeypatch.setattr(direct_call_sfu, 'turn_ice_servers', lambda subject: calls.append(subject) or [{'urls': ['turn:example.test']}])
    allowed = False
    monkeypatch.setattr(direct_call_sfu.direct_call_signaling_manager, 'media_allowed', lambda *args: allowed)
    class MediaClient:
        async def __aenter__(self):
            return SimpleNamespace(room=SimpleNamespace(create_room=AsyncMock()))
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr(direct_call_sfu, '_client', MediaClient)
    async def issue():
        return await direct_call_sfu.issue_call_token(str(uuid4()), 'test-user', 'Test', str(uuid4()), 'test-device')
    with pytest.raises(HTTPException) as denied:
        asyncio.run(issue())
    assert denied.value.status_code == 403 and not calls
    allowed = True
    assert asyncio.run(issue())['ice_servers']
    assert calls == ['user:test-user']
