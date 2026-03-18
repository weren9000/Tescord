from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Channel, VoiceAccessRole, VoiceChannelAccess

INITIAL_STRANGER_ALLOW_WINDOW = timedelta(minutes=5)
STRANGER_REJOIN_GRACE_WINDOW = timedelta(minutes=1)
STRANGER_REJECTION_BLOCK_WINDOW = timedelta(minutes=5)


@dataclass(slots=True)
class VoiceJoinGate:
    visible: bool
    role: VoiceAccessRole | None
    can_join_directly: bool
    blocked_until: datetime | None


def utc_now() -> datetime:
    return datetime.now(UTC)


def get_voice_channel_access(db: Session, channel_id: UUID, user_id: UUID) -> VoiceChannelAccess | None:
    return db.execute(
        select(VoiceChannelAccess).where(
            VoiceChannelAccess.channel_id == channel_id,
            VoiceChannelAccess.user_id == user_id,
        )
    ).scalar_one_or_none()


def list_voice_channel_access_map(
    db: Session,
    channel_ids: list[UUID],
    user_id: UUID,
) -> dict[UUID, VoiceChannelAccess]:
    if not channel_ids:
        return {}

    rows = db.execute(
        select(VoiceChannelAccess).where(
            VoiceChannelAccess.user_id == user_id,
            VoiceChannelAccess.channel_id.in_(channel_ids),
        )
    ).scalars().all()
    return {row.channel_id: row for row in rows}


def get_voice_channel_owner_access(db: Session, channel_id: UUID) -> VoiceChannelAccess | None:
    return db.execute(
        select(VoiceChannelAccess).where(
            VoiceChannelAccess.channel_id == channel_id,
            VoiceChannelAccess.role == VoiceAccessRole.OWNER,
        )
    ).scalar_one_or_none()


def can_view_voice_channel(access: VoiceChannelAccess | None) -> bool:
    return access is not None


def is_voice_access_blocked(access: VoiceChannelAccess | None, now: datetime | None = None) -> bool:
    if access is None or access.blocked_until is None:
        return False

    current_time = now or utc_now()
    return access.blocked_until > current_time


def can_join_voice_channel_directly(access: VoiceChannelAccess | None, now: datetime | None = None) -> bool:
    if access is None:
        return False

    current_time = now or utc_now()
    if is_voice_access_blocked(access, current_time):
        return False

    if access.role in {VoiceAccessRole.OWNER, VoiceAccessRole.RESIDENT}:
        return True

    return access.temporary_access_until is not None and access.temporary_access_until > current_time


def build_voice_join_gate(access: VoiceChannelAccess | None, now: datetime | None = None) -> VoiceJoinGate:
    current_time = now or utc_now()
    return VoiceJoinGate(
        visible=can_view_voice_channel(access),
        role=access.role if access is not None else None,
        can_join_directly=can_join_voice_channel_directly(access, current_time),
        blocked_until=access.blocked_until if is_voice_access_blocked(access, current_time) else None,
    )


def ensure_voice_channel_owner_permission(db: Session, channel: Channel) -> VoiceChannelAccess:
    existing_owner = get_voice_channel_owner_access(db, channel.id)
    if existing_owner is not None:
        return existing_owner

    owner_access = VoiceChannelAccess(
        channel_id=channel.id,
        user_id=channel.created_by_id,
        role=VoiceAccessRole.OWNER,
    )
    db.add(owner_access)
    db.flush()
    return owner_access


def grant_stranger_temporary_access(access: VoiceChannelAccess, *, now: datetime | None = None) -> None:
    access.blocked_until = None
    access.temporary_access_until = (now or utc_now()) + INITIAL_STRANGER_ALLOW_WINDOW


def mark_stranger_rejoin_grace(access: VoiceChannelAccess, *, now: datetime | None = None) -> None:
    access.temporary_access_until = (now or utc_now()) + STRANGER_REJOIN_GRACE_WINDOW


def block_stranger_access(access: VoiceChannelAccess, *, now: datetime | None = None) -> None:
    access.temporary_access_until = None
    access.blocked_until = (now or utc_now()) + STRANGER_REJECTION_BLOCK_WINDOW
