"""Serialize new addressed contacts with personal block changes."""
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, text
from sqlalchemy.orm import Session

from app.db.models import FriendBlock


def ensure_can_add_users(db: Session, actor_id: UUID, target_ids) -> None:
    targets = set(target_ids) - {actor_id}
    if not targets:
        return
    # Same lock as friends._lock_friendships. Acquire before chat row locks.
    db.execute(text('SELECT pg_advisory_xact_lock(742190043)'))
    blocked = db.scalar(select(FriendBlock.id).where(or_(
        and_(FriendBlock.blocker_user_id == actor_id, FriendBlock.blocked_user_id.in_(targets)),
        and_(FriendBlock.blocked_user_id == actor_id, FriendBlock.blocker_user_id.in_(targets)),
    )).limit(1))
    if blocked is not None:
        raise HTTPException(403, 'Нельзя добавить участника из-за личной блокировки')
