from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import Channel, ChannelType, MemberRole, Server, ServerMember, User
from app.db.session import get_db
from app.schemas.workspace import (
    ChannelSummary,
    CreateChannelRequest,
    CreateServerRequest,
    ServerMemberSummary,
    ServerSummary,
)

router = APIRouter(prefix="/servers", tags=["workspace"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[\W_]+", "-", value.casefold(), flags=re.UNICODE).strip("-")
    return slug or "group"


def _build_server_summary(server: Server, role: MemberRole) -> ServerSummary:
    return ServerSummary(
        id=server.id,
        name=server.name,
        slug=server.slug,
        description=server.description,
        member_role=role.value,
    )


def _build_channel_summary(channel: Channel) -> ChannelSummary:
    return ChannelSummary(
        id=channel.id,
        server_id=channel.server_id,
        name=channel.name,
        topic=channel.topic,
        type=channel.type.value,
        position=channel.position,
    )


def _build_server_member_summary(member: ServerMember, user: User) -> ServerMemberSummary:
    return ServerMemberSummary(
        id=member.id,
        user_id=user.id,
        login=user.email,
        nick=user.username,
        full_name=user.display_name,
        character_name=user.bio,
        role=member.role.value,
    )


def _ensure_unique_slug(db: Session, base_slug: str) -> str:
    slug = base_slug
    counter = 2

    while db.execute(select(Server.id).where(Server.slug == slug)).scalar_one_or_none() is not None:
        slug = f"{base_slug}-{counter}"
        counter += 1

    return slug


def _get_membership(db: Session, server_id: UUID, user_id: UUID) -> ServerMember | None:
    return db.execute(
        select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()


def _get_accessible_server(db: Session, server_id: UUID, current_user: User) -> tuple[Server, ServerMember | None]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")

    membership = _get_membership(db, server_id, current_user.id)
    if membership is None and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")

    return server, membership


def _ensure_manage_permission(membership: ServerMember | None, current_user: User) -> MemberRole:
    if current_user.is_admin:
        return membership.role if membership is not None else MemberRole.ADMIN

    if membership is None or membership.role not in {MemberRole.OWNER, MemberRole.ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления группой")

    return membership.role


@router.get("", response_model=list[ServerSummary])
def list_servers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ServerSummary]:
    rows = db.execute(
        select(Server, ServerMember.role)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(ServerMember.user_id == current_user.id)
        .order_by(Server.name)
    ).all()

    return [_build_server_summary(server, role) for server, role in rows]


@router.post("", response_model=ServerSummary, status_code=status.HTTP_201_CREATED)
def create_server(
    payload: CreateServerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ServerSummary:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор может создавать группы")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Название группы не может быть пустым")

    description = payload.description.strip() if payload.description else None
    slug = _ensure_unique_slug(db, _slugify(name))

    server = Server(
        name=name,
        slug=slug,
        description=description,
        owner_id=current_user.id,
    )
    db.add(server)
    db.flush()

    membership = ServerMember(
        server_id=server.id,
        user_id=current_user.id,
        role=MemberRole.OWNER,
        nickname=current_user.username,
    )
    db.add(membership)
    db.commit()
    db.refresh(server)

    return _build_server_summary(server, MemberRole.OWNER)


@router.get("/{server_id}/channels", response_model=list[ChannelSummary])
def list_server_channels(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChannelSummary]:
    server, _ = _get_accessible_server(db, server_id, current_user)
    channels = db.execute(
        select(Channel).where(Channel.server_id == server.id).order_by(Channel.position, Channel.name)
    ).scalars().all()

    return [_build_channel_summary(channel) for channel in channels]


@router.get("/{server_id}/members", response_model=list[ServerMemberSummary])
def list_server_members(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ServerMemberSummary]:
    server, _ = _get_accessible_server(db, server_id, current_user)
    rows = db.execute(
        select(ServerMember, User)
        .join(User, User.id == ServerMember.user_id)
        .where(ServerMember.server_id == server.id)
        .order_by(ServerMember.joined_at, User.username)
    ).all()

    return [_build_server_member_summary(member, user) for member, user in rows]


@router.post("/{server_id}/channels", response_model=ChannelSummary, status_code=status.HTTP_201_CREATED)
def create_server_channel(
    server_id: UUID,
    payload: CreateChannelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelSummary:
    server, membership = _get_accessible_server(db, server_id, current_user)
    _ensure_manage_permission(membership, current_user)

    channel_name = payload.name.strip()
    if not channel_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Название канала не может быть пустым")

    existing_channel = db.execute(
        select(Channel.id).where(Channel.server_id == server.id, func.lower(Channel.name) == channel_name.lower())
    ).scalar_one_or_none()
    if existing_channel is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Канал с таким именем уже существует")

    next_position = (
        db.execute(select(func.max(Channel.position)).where(Channel.server_id == server.id)).scalar_one_or_none() or -1
    ) + 1

    channel = Channel(
        server_id=server.id,
        created_by_id=current_user.id,
        name=channel_name,
        topic=payload.topic.strip() if payload.topic else None,
        type=ChannelType(payload.type),
        position=next_position,
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)

    return _build_channel_summary(channel)
