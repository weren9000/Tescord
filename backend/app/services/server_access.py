from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Channel, PlatformMember, Server, ServerBlock, ServerKind, ServerMember, User


def get_membership(db: Session, server_id: UUID, user_id: UUID) -> ServerMember | None:
    return db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()


def is_server_blocked(db: Session, server_id: UUID, user_id: UUID) -> bool:
    return (
        db.execute(select(ServerBlock.id).where(ServerBlock.server_id == server_id, ServerBlock.user_id == user_id))
        .scalar_one_or_none()
        is not None
    )


def get_accessible_server(
    db: Session,
    server_id: UUID,
    current_user: User,
    *,
    allow_workspace_auto_join: bool = False,
) -> tuple[Server, ServerMember | None]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")

    membership = get_membership(db, server_id, current_user.id)
    if server.platform_id is not None and db.scalar(select(PlatformMember.id).where(
        PlatformMember.platform_id == server.platform_id, PlatformMember.user_id == current_user.id
    )) is None:
        raise HTTPException(404, "Площадка недоступна")
    if server.kind == ServerKind.WORKSPACE and allow_workspace_auto_join:
        return server, membership

    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чат не найден")

    return server, membership


def ensure_channel_server_access(db: Session, channel: Channel, current_user: User) -> tuple[Server, ServerMember | None]:
    return get_accessible_server(
        db,
        channel.server_id,
        current_user,
        allow_workspace_auto_join=False,
    )
