from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Channel, MemberRole, Server, ServerKind, ServerMember, User
from app.services.app_events import publish_members_updated_from_sync


def get_membership(db: Session, server_id: UUID, user_id: UUID) -> ServerMember | None:
    return db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()


def ensure_workspace_membership(db: Session, server_id: UUID, current_user: User) -> ServerMember:
    membership = get_membership(db, server_id, current_user.id)
    if membership is not None:
        return membership

    membership = ServerMember(
        server_id=server_id,
        user_id=current_user.id,
        role=MemberRole.MEMBER,
        nickname=current_user.username,
    )
    db.add(membership)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        membership = get_membership(db, server_id, current_user.id)
        if membership is None:
            raise
        return membership

    db.refresh(membership)
    publish_members_updated_from_sync(server_id, reason="member_joined")
    return membership


def get_accessible_server(
    db: Session,
    server_id: UUID,
    current_user: User,
    *,
    allow_workspace_auto_join: bool = True,
) -> tuple[Server, ServerMember | None]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")

    membership = get_membership(db, server_id, current_user.id)
    if server.kind == ServerKind.WORKSPACE and allow_workspace_auto_join:
        membership = membership or ensure_workspace_membership(db, server_id, current_user)
        return server, membership

    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")

    return server, membership


def ensure_channel_server_access(db: Session, channel: Channel, current_user: User) -> tuple[Server, ServerMember | None]:
    return get_accessible_server(
        db,
        channel.server_id,
        current_user,
        allow_workspace_auto_join=True,
    )
