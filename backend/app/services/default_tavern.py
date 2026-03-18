from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Channel, ChannelType, Server, User, VoiceAccessRole, VoiceChannelAccess

DEFAULT_TAVERN_NAME = "Таверна"
DEFAULT_TAVERN_TOPIC = "Общий голосовой канал для всех участников группы"


def is_default_tavern_channel(channel: Channel) -> bool:
    return bool(channel.is_default_tavern)


def ensure_default_tavern_channel(
    db: Session,
    server: Server,
    *,
    created_by_id: UUID,
) -> Channel:
    channel = db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.is_default_tavern.is_(True))
    ).scalar_one_or_none()

    if channel is None:
        channel = db.execute(
            select(Channel).where(
                Channel.server_id == server.id,
                Channel.type == ChannelType.VOICE,
                func.lower(Channel.name) == DEFAULT_TAVERN_NAME.casefold(),
            )
        ).scalar_one_or_none()

    if channel is None:
        next_position = (
            db.execute(select(func.max(Channel.position)).where(Channel.server_id == server.id)).scalar_one_or_none() or -1
        ) + 1
        channel = Channel(
            server_id=server.id,
            created_by_id=created_by_id,
            name=DEFAULT_TAVERN_NAME,
            topic=DEFAULT_TAVERN_TOPIC,
            type=ChannelType.VOICE,
            position=next_position,
            is_default_tavern=True,
        )
        db.add(channel)
        db.flush()
        return channel

    channel.is_default_tavern = True
    if channel.type != ChannelType.VOICE:
        channel.type = ChannelType.VOICE
    if not channel.topic:
        channel.topic = DEFAULT_TAVERN_TOPIC
    return channel


def ensure_default_tavern_access_for_user(db: Session, user: User) -> None:
    channels = db.execute(
        select(Channel).where(Channel.type == ChannelType.VOICE, Channel.is_default_tavern.is_(True))
    ).scalars().all()
    if not channels:
        return

    ensure_default_tavern_access_for_users(db, channels, [user])


def ensure_default_tavern_access_for_users(
    db: Session,
    channels: Iterable[Channel],
    users: Iterable[User],
) -> None:
    user_list = list(users)
    if not user_list:
        return

    for channel in channels:
        if not channel.is_default_tavern:
            continue

        existing_access = {
            access.user_id: access
            for access in db.execute(
                select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id == channel.id)
            ).scalars().all()
        }

        for access in existing_access.values():
            access.role = VoiceAccessRole.RESIDENT
            access.owner_muted = False
            access.blocked_until = None
            access.temporary_access_until = None

        for user in user_list:
            access = existing_access.get(user.id)
            if access is None:
                db.add(
                    VoiceChannelAccess(
                        channel_id=channel.id,
                        user_id=user.id,
                        role=VoiceAccessRole.RESIDENT,
                    )
                )
            else:
                access.role = VoiceAccessRole.RESIDENT
                access.owner_muted = False
                access.blocked_until = None
                access.temporary_access_until = None

        db.flush()


def ensure_default_tavern_workspace_setup(db: Session) -> None:
    servers = db.execute(select(Server).order_by(Server.created_at, Server.id)).scalars().all()
    if not servers:
        return

    users = db.execute(select(User).order_by(User.created_at, User.id)).scalars().all()
    if not users:
        return

    taverns: list[Channel] = []
    for server in servers:
        taverns.append(ensure_default_tavern_channel(db, server, created_by_id=server.owner_id))

    ensure_default_tavern_access_for_users(db, taverns, users)
