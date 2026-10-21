from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Channel, ChannelType, Server, ServerKind, ServerMember, VoiceAccessRole, VoiceChannelAccess

DEFAULT_GROUP_CHAT_TEXT_NAME = "Чат"
DEFAULT_GROUP_CHAT_TEXT_TOPIC = "Общий чат группы"
DEFAULT_GROUP_CHAT_VOICE_NAME = "Созвон"
DEFAULT_GROUP_CHAT_VOICE_TOPIC = "Общий голосовой чат группы"


def ensure_group_chat_text_channel(
    db: Session,
    server: Server,
    *,
    created_by_id: UUID,
) -> Channel:
    if server.kind != ServerKind.GROUP_CHAT:
        raise ValueError("Group chat defaults apply only to group_chat servers")

    channel = db.execute(
        select(Channel)
        .where(Channel.server_id == server.id, Channel.type == ChannelType.TEXT)
        .order_by(Channel.position, Channel.name)
    ).scalars().first()

    if channel is not None:
        if not channel.topic:
            channel.topic = DEFAULT_GROUP_CHAT_TEXT_TOPIC
        return channel

    channel = Channel(
        server_id=server.id,
        created_by_id=created_by_id,
        name=DEFAULT_GROUP_CHAT_TEXT_NAME,
        topic=DEFAULT_GROUP_CHAT_TEXT_TOPIC,
        type=ChannelType.TEXT,
        position=0,
    )
    db.add(channel)
    db.flush()
    return channel


def ensure_group_chat_voice_channel(
    db: Session,
    server: Server,
    *,
    created_by_id: UUID,
) -> Channel:
    if server.kind != ServerKind.GROUP_CHAT:
        raise ValueError("Group chat defaults apply only to group_chat servers")

    channel = db.execute(
        select(Channel)
        .where(Channel.server_id == server.id, Channel.type == ChannelType.VOICE)
        .order_by(Channel.position, Channel.name)
    ).scalars().first()

    if channel is not None:
        if not channel.topic:
            channel.topic = DEFAULT_GROUP_CHAT_VOICE_TOPIC
        return channel

    next_position = (
        db.execute(select(func.max(Channel.position)).where(Channel.server_id == server.id)).scalar_one_or_none() or -1
    ) + 1
    channel = Channel(
        server_id=server.id,
        created_by_id=created_by_id,
        name=DEFAULT_GROUP_CHAT_VOICE_NAME,
        topic=DEFAULT_GROUP_CHAT_VOICE_TOPIC,
        type=ChannelType.VOICE,
        position=next_position,
    )
    db.add(channel)
    db.flush()
    return channel


def ensure_group_chat_voice_access(db: Session, server: Server, channel: Channel) -> None:
    if server.kind != ServerKind.GROUP_CHAT:
        raise ValueError("Group chat defaults apply only to group_chat servers")

    members = db.execute(
        select(ServerMember).where(ServerMember.server_id == server.id)
    ).scalars().all()
    if not members:
        return

    existing_access = {
        access.user_id: access
        for access in db.execute(
            select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id == channel.id)
        ).scalars().all()
    }
    member_user_ids = {member.user_id for member in members}

    for member in members:
        desired_role = VoiceAccessRole.OWNER if member.user_id == server.owner_id else VoiceAccessRole.RESIDENT
        access = existing_access.get(member.user_id)
        if access is None:
            db.add(
                VoiceChannelAccess(
                    channel_id=channel.id,
                    user_id=member.user_id,
                    role=desired_role,
                )
            )
            continue

        access.role = desired_role
        if server.platform_id is None:
            access.owner_muted = False
        access.blocked_until = None
        access.temporary_access_until = None

    for user_id, access in existing_access.items():
        if user_id not in member_user_ids:
            db.delete(access)

    db.flush()


def ensure_group_chat_defaults(
    db: Session,
    server: Server,
    *,
    created_by_id: UUID | None = None,
) -> tuple[Channel, Channel]:
    if server.kind != ServerKind.GROUP_CHAT:
        raise ValueError("Group chat defaults apply only to group_chat servers")

    effective_created_by_id = created_by_id or server.owner_id
    text_channel = ensure_group_chat_text_channel(db, server, created_by_id=effective_created_by_id)
    voice_channel = ensure_group_chat_voice_channel(db, server, created_by_id=effective_created_by_id)
    ensure_group_chat_voice_access(db, server, voice_channel)
    return text_channel, voice_channel
