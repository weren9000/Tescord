import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.websockets import WebSocketState

from app.services.voice_signaling import VoiceAdmissionError, VoiceSignalingManager
from app.services.voice_sfu import prepare_voice_room


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
