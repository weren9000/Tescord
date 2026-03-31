from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies.auth import get_current_user
from app.db.models import Channel, ChannelType, MemberRole, Server, ServerKind, ServerMember, User
from app.db.session import get_db
from app.schemas.conversations import (
    ConversationDirectoryUserSummary,
    ConversationMemberPreview,
    ConversationSummary,
    CreateDirectConversationRequest,
    CreateGroupConversationRequest,
)
from app.services.app_events import publish_servers_changed_from_sync
from app.services.group_chat_defaults import ensure_group_chat_defaults
from app.services.server_icons import normalize_server_icon_asset
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _build_direct_key(left_user_id: UUID, right_user_id: UUID) -> str:
    left, right = sorted([left_user_id.hex, right_user_id.hex])
    return f"{left}:{right}"


def _conversation_slug(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _first_text_channel(server: Server) -> Channel:
    text_channels = sorted(
        (channel for channel in server.channels if channel.type == ChannelType.TEXT),
        key=lambda channel: (channel.position, channel.name.casefold()),
    )
    if not text_channels:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="У беседы нет текстового канала")
    return text_channels[0]


def _member_preview(member: ServerMember, online_user_ids: set[UUID]) -> ConversationMemberPreview:
    user = member.user
    return ConversationMemberPreview(
        user_id=user.id,
        public_id=user.public_id,
        login=user.email,
        nick=user.username,
        avatar_updated_at=user.avatar_updated_at,
        is_online=user.id in online_user_ids,
        role=member.role.value,
    )


def _conversation_title(server: Server, current_user_id: UUID) -> tuple[str, str | None]:
    if server.kind == ServerKind.DIRECT:
        peer_member = next((member for member in server.members if member.user_id != current_user_id), None)
        if peer_member is None:
            return server.name, None

        peer_user = peer_member.user
        return peer_user.username, peer_user.email

    subtitle = f"{len(server.members)} участников"
    return server.name, subtitle


def _build_conversation_summary(
    server: Server,
    membership: ServerMember,
    current_user_id: UUID,
    online_user_ids: set[UUID],
) -> ConversationSummary:
    title, subtitle = _conversation_title(server, current_user_id)
    members = sorted(server.members, key=lambda member: ((member.user_id != current_user_id), member.user.username.casefold()))
    return ConversationSummary(
        id=server.id,
        kind=server.kind.value,
        title=title,
        subtitle=subtitle,
        icon_asset=server.icon_asset,
        member_role=membership.role.value,
        primary_channel_id=_first_text_channel(server).id,
        members=[_member_preview(member, online_user_ids) for member in members],
    )


def _load_conversation(server_id: UUID, db: Session) -> Server | None:
    return db.execute(
        select(Server)
        .where(Server.id == server_id, Server.kind.in_((ServerKind.DIRECT, ServerKind.GROUP_CHAT)))
        .options(
            selectinload(Server.channels),
            selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalar_one_or_none()


def _resolve_conversation_target_user(
    payload: CreateDirectConversationRequest,
    current_user: User,
    db: Session,
) -> User:
    if payload.user_id is not None:
        if payload.user_id == current_user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя создать личный чат с самим собой")

        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        return user

    assert payload.user_public_id is not None
    if payload.user_public_id == current_user.public_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя создать личный чат с самим собой")

    user = db.execute(select(User).where(User.public_id == payload.user_public_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    return user


@router.get("", response_model=list[ConversationSummary])
def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConversationSummary]:
    memberships = db.execute(
        select(ServerMember)
        .join(Server, Server.id == ServerMember.server_id)
        .where(
            ServerMember.user_id == current_user.id,
            Server.kind.in_((ServerKind.DIRECT, ServerKind.GROUP_CHAT)),
        )
        .options(
            joinedload(ServerMember.server).selectinload(Server.channels),
            joinedload(ServerMember.server).selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalars().all()

    online_user_ids = site_presence_manager.online_user_ids(
        [member.user_id for membership in memberships for member in membership.server.members]
    )
    summaries = [
        _build_conversation_summary(membership.server, membership, current_user.id, online_user_ids)
        for membership in memberships
    ]
    summaries.sort(key=lambda item: (0 if item.kind == ServerKind.DIRECT.value else 1, item.title.casefold()))
    return summaries


@router.get("/directory", response_model=list[ConversationDirectoryUserSummary])
def list_conversation_directory(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConversationDirectoryUserSummary]:
    users = db.execute(
        select(User).where(User.id != current_user.id).order_by(User.username)
    ).scalars().all()
    online_user_ids = site_presence_manager.online_user_ids([user.id for user in users])
    return [
        ConversationDirectoryUserSummary(
            user_id=user.id,
            public_id=user.public_id,
            login=user.email,
            nick=user.username,
            avatar_updated_at=user.avatar_updated_at,
            is_online=user.id in online_user_ids,
        )
        for user in users
    ]


@router.post("/direct", response_model=ConversationSummary, status_code=status.HTTP_201_CREATED)
def open_direct_conversation(
    payload: CreateDirectConversationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationSummary:
    peer_user = _resolve_conversation_target_user(payload, current_user, db)

    direct_key = _build_direct_key(current_user.id, peer_user.id)
    existing_server = db.execute(
        select(Server)
        .where(Server.direct_key == direct_key, Server.kind == ServerKind.DIRECT)
        .options(
            selectinload(Server.channels),
            selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalar_one_or_none()
    if existing_server is not None:
        membership = next(
            member for member in existing_server.members if member.user_id == current_user.id
        )
        online_user_ids = site_presence_manager.online_user_ids([member.user_id for member in existing_server.members])
        return _build_conversation_summary(existing_server, membership, current_user.id, online_user_ids)

    server = Server(
        name=f"{current_user.username} / {peer_user.username}",
        slug=_conversation_slug("direct"),
        kind=ServerKind.DIRECT,
        direct_key=direct_key,
        owner_id=current_user.id,
    )
    db.add(server)
    db.flush()

    db.add_all(
        [
            ServerMember(
                server_id=server.id,
                user_id=current_user.id,
                role=MemberRole.OWNER,
                nickname=current_user.username,
            ),
            ServerMember(
                server_id=server.id,
                user_id=peer_user.id,
                role=MemberRole.MEMBER,
                nickname=peer_user.username,
            ),
            Channel(
                server_id=server.id,
                created_by_id=current_user.id,
                name="Личные сообщения",
                topic=None,
                type=ChannelType.TEXT,
                position=0,
            ),
        ]
    )
    db.flush()
    ensure_group_chat_defaults(db, server, created_by_id=current_user.id)
    db.commit()

    created_server = _load_conversation(server.id, db)
    if created_server is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Не удалось создать личный чат")

    publish_servers_changed_from_sync(reason="conversation_created")
    membership = next(member for member in created_server.members if member.user_id == current_user.id)
    online_user_ids = site_presence_manager.online_user_ids([member.user_id for member in created_server.members])
    return _build_conversation_summary(created_server, membership, current_user.id, online_user_ids)


@router.post("/group", response_model=ConversationSummary, status_code=status.HTTP_201_CREATED)
def create_group_conversation(
    payload: CreateGroupConversationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationSummary:
    member_ids = {member_id for member_id in payload.member_ids if member_id != current_user.id}
    users = (
        db.execute(select(User).where(User.id.in_(member_ids)).order_by(User.username)).scalars().all()
        if member_ids
        else []
    )
    if len(users) != len(member_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Не все участники найдены")

    total_participants = len(users) + 1
    if total_participants > 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="В мини-группе может быть не больше 10 участников")

    try:
        icon_asset = normalize_server_icon_asset(payload.icon_asset)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    server = Server(
        name=payload.name.strip(),
        slug=_conversation_slug("group"),
        description=f"Мини-группа · {total_participants} участников",
        icon_asset=icon_asset,
        kind=ServerKind.GROUP_CHAT,
        owner_id=current_user.id,
    )
    db.add(server)
    db.flush()

    db.add(
        ServerMember(
            server_id=server.id,
            user_id=current_user.id,
            role=MemberRole.OWNER,
            nickname=current_user.username,
        )
    )
    db.add_all(
        [
            ServerMember(
                server_id=server.id,
                user_id=user.id,
                role=MemberRole.MEMBER,
                nickname=user.username,
            )
            for user in users
        ]
    )
    db.flush()
    ensure_group_chat_defaults(db, server, created_by_id=current_user.id)
    db.commit()

    created_server = _load_conversation(server.id, db)
    if created_server is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Не удалось создать мини-группу")

    publish_servers_changed_from_sync(reason="conversation_created")
    membership = next(member for member in created_server.members if member.user_id == current_user.id)
    online_user_ids = site_presence_manager.online_user_ids([member.user_id for member in created_server.members])
    return _build_conversation_summary(created_server, membership, current_user.id, online_user_ids)
