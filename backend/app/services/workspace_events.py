from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Channel, ChannelType, ServerMember, User
from app.schemas.workspace import (
    ChannelSummary,
    ServerMemberSummary,
    VoiceChannelPresenceSummary,
    VoicePresenceParticipantSummary,
)
from app.services.site_presence import site_presence_manager
from app.services.voice_access import can_view_voice_channel, list_voice_channel_access_map
from app.services.voice_signaling import voice_signaling_manager


def _build_channel_summary(channel: Channel, voice_access_role: str | None = None) -> ChannelSummary:
    return ChannelSummary(
        id=channel.id,
        server_id=channel.server_id,
        name=channel.name,
        topic=channel.topic,
        type=channel.type.value,
        position=channel.position,
        voice_access_role=voice_access_role,
    )


def _build_server_member_summary(
    member: ServerMember,
    user: User,
    online_user_ids: set[UUID],
) -> ServerMemberSummary:
    return ServerMemberSummary(
        id=member.id,
        user_id=user.id,
        login=user.email,
        nick=user.username,
        full_name=user.display_name,
        character_name=user.bio,
        avatar_updated_at=user.avatar_updated_at,
        role=member.role.value,
        is_online=user.id in online_user_ids,
    )


def _build_voice_channel_presence_summary(
    channel: Channel,
    participants: list[dict[str, object]],
) -> VoiceChannelPresenceSummary:
    return VoiceChannelPresenceSummary(
        channel_id=channel.id,
        channel_name=channel.name,
        participants=[
            VoicePresenceParticipantSummary(
                participant_id=str(participant["id"]),
                user_id=UUID(str(participant["user_id"])),
                nick=str(participant["nick"]),
                full_name=str(participant["full_name"]),
                character_name=(
                    str(participant["character_name"])
                    if participant.get("character_name") is not None
                    else None
                ),
                avatar_updated_at=(
                    datetime.fromisoformat(str(participant["avatar_updated_at"]))
                    if participant.get("avatar_updated_at") is not None
                    else None
                ),
                muted=bool(participant["muted"]),
                owner_muted=bool(participant.get("owner_muted", False)),
            )
            for participant in participants
        ],
    )


def list_server_channels_for_user(
    db: Session,
    server_id: UUID,
    user_id: UUID,
) -> list[ChannelSummary]:
    channels = db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position, Channel.name)
    ).scalars().all()
    voice_channel_ids = [channel.id for channel in channels if channel.type == ChannelType.VOICE]
    voice_access_map = list_voice_channel_access_map(db, voice_channel_ids, user_id)

    visible_channels: list[ChannelSummary] = []
    for channel in channels:
        if channel.type != ChannelType.VOICE:
            visible_channels.append(_build_channel_summary(channel))
            continue

        access = voice_access_map.get(channel.id)
        if can_view_voice_channel(access):
            visible_channels.append(_build_channel_summary(channel, access.role.value))

    return visible_channels


def list_server_members_for_user(db: Session, server_id: UUID) -> list[ServerMemberSummary]:
    rows = db.execute(
        select(ServerMember, User)
        .join(User, User.id == ServerMember.user_id)
        .where(ServerMember.server_id == server_id)
        .order_by(ServerMember.joined_at, User.username)
    ).all()
    online_user_ids = site_presence_manager.online_user_ids([user.id for _, user in rows])

    return [
        _build_server_member_summary(member, user, online_user_ids)
        for member, user in rows
    ]


async def list_server_voice_presence_for_user(
    db: Session,
    server_id: UUID,
    user_id: UUID,
) -> list[VoiceChannelPresenceSummary]:
    voice_channels = db.execute(
        select(Channel)
        .where(Channel.server_id == server_id, Channel.type == ChannelType.VOICE)
        .order_by(Channel.position, Channel.name)
    ).scalars().all()
    voice_access_map = list_voice_channel_access_map(db, [channel.id for channel in voice_channels], user_id)
    visible_voice_channels = [channel for channel in voice_channels if can_view_voice_channel(voice_access_map.get(channel.id))]
    if not visible_voice_channels:
        return []

    snapshot = await voice_signaling_manager.snapshot_rooms({str(channel.id) for channel in visible_voice_channels})

    return [
        _build_voice_channel_presence_summary(channel, snapshot[str(channel.id)])
        for channel in visible_voice_channels
        if str(channel.id) in snapshot
    ]
