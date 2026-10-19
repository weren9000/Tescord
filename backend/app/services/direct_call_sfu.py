"""LiveKit rooms scoped to an accepted personal call, never a public channel."""
import json
import asyncio
import logging
from datetime import timedelta

from fastapi import HTTPException
from livekit import api

from app.core.config import get_settings
from app.services.voice_sfu import _client
from app.services.direct_call_signaling import direct_call_signaling_manager

logger = logging.getLogger(__name__)


async def delete_call_room(call_id: str):
    if not get_settings().livekit_enabled:
        return
    try:
        async with _client() as client:
            await client.room.delete_room(api.DeleteRoomRequest(room='direct-' + call_id))
    except api.TwirpError as exc:
        if exc.code != 'not_found':
            logger.warning('Personal call room cleanup will be enforced by reconciliation')
    except Exception:
        logger.warning('Personal call room cleanup will be enforced by reconciliation')


async def issue_call_token(call_id: str, user_id: str, nick: str, session_id: str, client_id: str):
    settings = get_settings()
    if not settings.livekit_enabled:
        raise HTTPException(503, 'Сервер звонков недоступен')
    if not await asyncio.to_thread(direct_call_signaling_manager.media_allowed, call_id, user_id, client_id):
        raise HTTPException(403, 'Нет доступа к этому звонку')
    room = 'direct-' + call_id
    try:
        async with _client() as client:
            await client.room.create_room(api.CreateRoomRequest(name=room, max_participants=2, empty_timeout=60, departure_timeout=20))
    except Exception as exc:
        raise HTTPException(503, 'Не удалось подготовить звонок') from exc
    # The call may have ended while the media server was responding.
    if not await asyncio.to_thread(direct_call_signaling_manager.media_allowed, call_id, user_id, client_id):
        await delete_call_room(call_id)
        raise HTTPException(403, 'Звонок уже завершён')
    token = (api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user_id).with_name(nick)
        .with_metadata(json.dumps({'session_id': session_id, 'client_id': client_id}))
        .with_ttl(timedelta(minutes=2))
        .with_grants(api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True))
        .to_jwt())
    return {'url': settings.livekit_url, 'token': token, 'room_name': room, 'identity': user_id}
