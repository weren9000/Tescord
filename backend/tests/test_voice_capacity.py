import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.websockets import WebSocketState

from app.services.voice_signaling import VoiceAdmissionError, VoiceSignalingManager
from app.services.voice_sfu import prepare_voice_room


def test_cluster_admission_keeps_existing_members_and_limits_concurrent_joins(monkeypatch):
    from copy import deepcopy
    from app.services import cluster as c
    from app.services.cluster_signaling import ClusterVoiceSignalingManager

    async def scenario():
        state = {'rooms': {}, 'connections': {}, 'calls': {}}
        delivered = []
        lock = asyncio.Lock()
        async def mutate(change):
            nonlocal state
            async with lock:
                candidate, events = deepcopy(state), []
                result = change(candidate, events)
                state = candidate
                delivered.extend(events)
                return result
        monkeypatch.setattr(c, 'mutate', mutate)
        monkeypatch.setattr(c, 'local_sockets', {})
        managers = [ClusterVoiceSignalingManager() for _ in range(4)]
        async def join(i):
            socket = SimpleNamespace(application_state=WebSocketState.CONNECTED)
            return await managers[i % 4].connect(socket, 'platform-room', user_id=str(i), public_id=i, nick=str(i))
        first = await join(0)
        results = await asyncio.gather(*(join(i) for i in range(1, 40)), return_exceptions=True)
        assert sum(not isinstance(r, Exception) for r in results) == 29
        rejected = [r for r in results if isinstance(r, VoiceAdmissionError)]
        assert len(rejected) == 10 and all(r.code == 4429 for r in rejected)
        assert first.id in state['rooms']['platform-room']
        assert len(c.local_sockets) == 30
        assert not any(e['close'] for e in delivered)
        before = deepcopy(state)
        with pytest.raises(VoiceAdmissionError) as duplicate:
            await join(0)
        assert duplicate.value.code == 4409
        assert state == before and len(c.local_sockets) == 30
        await managers[0].disconnect('platform-room', first.id)
        replacement = await join(40)
        assert replacement.id in state['rooms']['platform-room']
        assert len(state['rooms']['platform-room']) == 30
    asyncio.run(scenario())


def test_concurrent_admission_duplicate_and_released_seat():
    async def scenario():
        manager = VoiceSignalingManager()
        async def join(i, room='room'):
            socket = SimpleNamespace(application_state=WebSocketState.CONNECTED, send_json=AsyncMock())
            return await manager.connect(socket, room, user_id=str(i), public_id=i, nick=str(i))
        results = await asyncio.gather(*(join(i) for i in range(40)), return_exceptions=True)
        admitted = [p for p in results if not isinstance(p, Exception)]
        rejected = [p for p in results if isinstance(p, VoiceAdmissionError)]
        assert len(admitted) == 30
        assert len(rejected) == 10 and all(p.code == 4429 for p in rejected)
        with pytest.raises(VoiceAdmissionError) as duplicate:
            await join(0)
        assert duplicate.value.code == 4409
        await manager.disconnect('room', admitted[0].id)
        await join(99)
        await join(99, 'other-room')
        assert len((await manager.snapshot_rooms({'room'}))['room']) == 30
    asyncio.run(scenario())


def test_media_room_capacity_and_friendly_full_error():
    async def scenario():
        rooms = SimpleNamespace(create_room=AsyncMock(return_value=SimpleNamespace(max_participants=30)), list_participants=AsyncMock(
            return_value=SimpleNamespace(participants=[SimpleNamespace(identity=str(i)) for i in range(30)])))
        client = AsyncMock()
        client.__aenter__.return_value = SimpleNamespace(room=rooms)
        with patch('app.services.voice_sfu._client', return_value=client), patch(
            'app.services.voice_sfu.get_settings', return_value=SimpleNamespace(livekit_enabled=True, voice_room_capacity=30)
        ):
            with pytest.raises(HTTPException) as full:
                await prepare_voice_room('room', '31')
            assert full.value.status_code == 409
            assert '30' in full.value.detail
            assert rooms.create_room.call_args.args[0].max_participants == 30
            await prepare_voice_room('room', '0')
            rooms.create_room.return_value = SimpleNamespace(max_participants=0)
            with pytest.raises(HTTPException) as legacy:
                await prepare_voice_room('room', '0')
            assert legacy.value.status_code == 409
            assert 'обновляется' in legacy.value.detail
    asyncio.run(scenario())


def test_platform_tokens_have_unique_identities_and_allow_all_30_to_publish(monkeypatch):
    from uuid import uuid4
    from livekit import api
    from app.api.routes import voice
    settings = SimpleNamespace(livekit_enabled=True, livekit_api_key='test-key',
        livekit_api_secret='test-secret-with-at-least-32-characters',
        livekit_url='ws://localhost:7880', voice_room_capacity=30)
    monkeypatch.setattr(voice, 'settings', settings)
    channel = SimpleNamespace(id=uuid4())
    verifier = api.TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret)
    identities = set()
    for i in range(30):
        user = SimpleNamespace(id=uuid4(), username=f'participant-{i}')
        response = voice._build_voice_sfu_token(channel, user, session_id=str(uuid4()))
        claims = verifier.verify(response.token)
        identities.add(claims.identity)
        assert claims.video.room == str(channel.id)
        assert claims.video.can_publish and claims.video.can_subscribe
        assert claims.room_config.max_participants == 30
    assert len(identities) == 30
