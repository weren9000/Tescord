from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Channel, ChannelReadState, ChannelType, Message, ServerMember, User
from app.schemas.workspace import (
    ChannelSummary,
    ServerMemberSummary,
    VoiceChannelPresenceSummary,
    VoicePresenceParticipantSummary,
)
from app.services.site_presence import site_presence_manager
from app.services.voice_access import can_view_voice_channel, get_effective_voice_access_role, list_voice_channel_access_map
from app.services.voice_signaling import voice_signaling_manager


def _build_channel_summary(
    channel: Channel,
    voice_access_role: str | None = None,
    unread_count: int = 0,
) -> ChannelSummary:
    return ChannelSummary(
        id=channel.id,
        server_id=channel.server_id,
        name=channel.name,
        topic=channel.topic,
        type=channel.type.value,
        position=channel.position,
        voice_access_role=voice_access_role,
        unread_count=max(0, unread_count),
    )


def _build_server_member_summary(
    member: ServerMember,
    user: User,
    online_user_ids: set[UUID],
) -> ServerMemberSummary:
    return ServerMemberSummary(
        id=member.id,
        user_id=user.id,
        public_id=user.public_id,
        login=user.email,
        nick=user.username,
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
                public_id=int(participant.get("public_id", 0)),
                nick=str(participant["nick"]),
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


def load_unread_counts_by_channel_id(
    db: Session,
    channel_ids: list[UUID],
    current_user_id: UUID,
) -> dict[UUID, int]:
    if not channel_ids:
        return {}

    last_read_state_subquery = (
        select(
            ChannelReadState.channel_id.label("channel_id"),
            Message.created_at.label("last_read_created_at"),
            Message.id.label("last_read_message_id"),
        )
        .select_from(ChannelReadState)
        .outerjoin(Message, Message.id == ChannelReadState.last_read_message_id)
        .where(
            ChannelReadState.user_id == current_user_id,
            ChannelReadState.channel_id.in_(channel_ids),
        )
        .subquery()
    )

    unread_rows = db.execute(
        select(Message.channel_id, func.count(Message.id))
        .select_from(Message)
        .outerjoin(last_read_state_subquery, last_read_state_subquery.c.channel_id == Message.channel_id)
        .where(
            Message.channel_id.in_(channel_ids),
            Message.author_id != current_user_id,
            or_(
                last_read_state_subquery.c.last_read_created_at.is_(None),
                Message.created_at > last_read_state_subquery.c.last_read_created_at,
                and_(
                    Message.created_at == last_read_state_subquery.c.last_read_created_at,
                    Message.id > last_read_state_subquery.c.last_read_message_id,
                ),
            ),
        )
        .group_by(Message.channel_id)
    ).all()

    unread_counts = {channel_id: count for channel_id, count in unread_rows}
    return {channel_id: unread_counts.get(channel_id, 0) for channel_id in channel_ids}


def list_server_channels_for_user(
    db: Session,
    server_id: UUID,
    user_id: UUID,
) -> list[ChannelSummary]:
    membership_role = db.execute(
        select(ServerMember.role).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()
    channels = db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position, Channel.name)
    ).scalars().all()
    voice_channel_ids = [channel.id for channel in channels if channel.type == ChannelType.VOICE]
    voice_access_map = list_voice_channel_access_map(db, voice_channel_ids, user_id)
    unread_counts_by_channel_id = load_unread_counts_by_channel_id(
        db,
        [channel.id for channel in channels],
        user_id,
    )

    visible_channels: list[ChannelSummary] = []
    for channel in channels:
        if channel.type != ChannelType.VOICE:
            visible_channels.append(
                _build_channel_summary(
                    channel,
                    unread_count=unread_counts_by_channel_id.get(channel.id, 0),
                )
            )
            continue

        access = voice_access_map.get(channel.id)
        effective_role = get_effective_voice_access_role(access, membership_role)
        if can_view_voice_channel(access, membership_role):
            visible_channels.append(
                _build_channel_summary(
                    channel,
                    effective_role.value if effective_role is not None else None,
                    unread_counts_by_channel_id.get(channel.id, 0),
                )
            )

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
    membership_role = db.execute(
        select(ServerMember.role).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()
    voice_channels = db.execute(
        select(Channel)
        .where(Channel.server_id == server_id, Channel.type == ChannelType.VOICE)
        .order_by(Channel.position, Channel.name)
    ).scalars().all()
    voice_access_map = list_voice_channel_access_map(db, [channel.id for channel in voice_channels], user_id)
    visible_voice_channels = [
        channel
        for channel in voice_channels
        if can_view_voice_channel(voice_access_map.get(channel.id), membership_role)
    ]
    if not visible_voice_channels:
        return []

    snapshot = await voice_signaling_manager.snapshot_rooms({str(channel.id) for channel in visible_voice_channels})

    return [
        _build_voice_channel_presence_summary(channel, snapshot[str(channel.id)])
        for channel in visible_voice_channels
        if str(channel.id) in snapshot
    ]
