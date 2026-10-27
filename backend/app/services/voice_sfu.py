"""Enforce persisted voice permissions on the media server as well as signaling."""
import asyncio
import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from aiohttp import ClientTimeout
from fastapi import HTTPException
from livekit import api
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import AuthSession, Channel, ServerBlock, ServerMember
from app.db.session import SessionLocal
from app.services.voice_access import get_voice_channel_access, can_view_voice_channel, can_join_voice_channel_directly, is_voice_access_blocked

logger = logging.getLogger(__name__)


def _client():
    settings = get_settings()
    return api.LiveKitAPI(settings.livekit_internal_url, settings.livekit_api_key, settings.livekit_api_secret, timeout=ClientTimeout(total=5))


async def prepare_voice_room(channel_id, user_id):
    settings = get_settings()
    if not settings.livekit_enabled:
        raise HTTPException(503, 'Голосовой сервер недоступен')
    try:
        async with _client() as client:
            room = await client.room.create_room(api.CreateRoomRequest(
                name=str(channel_id), max_participants=settings.voice_room_capacity,
                empty_timeout=60, departure_timeout=20))
            if room.max_participants != settings.voice_room_capacity:
                # Existing rooms keep their creation settings. Never interrupt a live call.
                raise HTTPException(409, 'Комната обновляется. Повторите вход после завершения текущей голосовой сессии')
            participants = await client.room.list_participants(api.ListParticipantsRequest(room=str(channel_id)))
            if len(participants.participants) >= settings.voice_room_capacity and not any(
                p.identity == str(user_id) for p in participants.participants
            ):
                raise HTTPException(409, f'В голосовой комнате уже {settings.voice_room_capacity} участников. Подключитесь, когда освободится место')
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, 'Не удалось подготовить голосовую комнату') from exc


def media_permission(room: str, identity: str, metadata: str, *, joining: bool) -> bool | None:
    """None denies participation, False permits listening, True permits publishing."""
    if room.startswith('meeting-'):
        from app.services.meeting_rooms import media_permission as meeting_permission
        return meeting_permission(room, identity, metadata)
    try:
        user_id = UUID(identity)
        session_id = UUID(json.loads(metadata)['session_id'])
    except (ValueError, TypeError, KeyError):
        return None
    with SessionLocal() as db:
        session = db.get(AuthSession, session_id)
        if session is None or session.user_id != user_id or session.revoked_at or session.expires_at <= datetime.now(timezone.utc):
            return None
        if room.startswith('direct-'):
            from app.services.direct_call_signaling import direct_call_signaling_manager
            return True if direct_call_signaling_manager.media_allowed(room[7:], str(user_id), json.loads(metadata).get('client_id', '')) else None
        try:
            channel_id = UUID(room)
        except ValueError:
            return None
        channel = db.get(Channel, channel_id)
        if channel is None:
            return None
        member = db.scalar(select(ServerMember).where(ServerMember.server_id == channel.server_id, ServerMember.user_id == user_id))
        blocked = db.scalar(select(ServerBlock.id).where(ServerBlock.server_id == channel.server_id, ServerBlock.user_id == user_id))
        if member is None or blocked:
            return None
        access = get_voice_channel_access(db, channel_id, user_id)
        if not can_view_voice_channel(access, member.role) or is_voice_access_blocked(access):
            return None
        if joining and not can_join_voice_channel_directly(access, member_role=member.role):
            return None
        return not bool(access and access.owner_muted)


async def enforce_participant(channel_id, user_id, *, can_publish: bool | None):
    if not get_settings().livekit_enabled:
        return
    try:
        async with _client() as client:
            if can_publish is None:
                await client.room.remove_participant(api.RoomParticipantIdentity(room=str(channel_id), identity=str(user_id)))
            else:
                await client.room.update_participant(api.UpdateParticipantRequest(room=str(channel_id), identity=str(user_id), permission=api.ParticipantPermission(can_publish=can_publish, can_subscribe=True, can_publish_data=not str(channel_id).startswith('meeting-'))))
    except api.TwirpError as exc:
        if exc.code == 'not_found':
            return
        logger.warning('Media permission update deferred for channel %s', channel_id)
        raise HTTPException(503, 'Media server unavailable; restriction saved and will be retried') from exc
    except Exception as exc:
        logger.warning('Media permission update deferred for channel %s', channel_id)
        raise HTTPException(503, 'Media server unavailable; restriction saved and will be retried') from exc


async def reconcile_media_permissions():
    while True:
        await asyncio.sleep(5)
        if not get_settings().livekit_enabled:
            continue
        try:
            async with _client() as client:
                rooms = await client.room.list_rooms(api.ListRoomsRequest())
                for room in rooms.rooms:
                    participants = await client.room.list_participants(api.ListParticipantsRequest(room=room.name))
                    for participant in participants.participants:
                        permitted = await asyncio.to_thread(media_permission, room.name, participant.identity, participant.metadata, joining=False)
                        if permitted is None or participant.permission.can_publish != permitted:
                            await enforce_participant(room.name, participant.identity, can_publish=permitted)
        except Exception:
            logger.warning('Media permission reconciliation will be retried')
