from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies.auth import get_current_user
from app.db.models import (
    ConversationPushSetting,
    FriendRequest,
    FriendRequestStatus,
    MemberRole,
    Message,
    Server,
    ServerKind,
    ServerMember,
    User,
)
from app.db.session import get_db
from app.schemas.conversations import (
    ConversationDirectoryUserSummary,
    ConversationMemberPreview,
    ConversationSummary,
    CreateDirectConversationRequest,
    CreateGroupConversationRequest,
)
from app.services.app_events import publish_servers_changed_from_sync
from app.services.direct_conversations import conversation_slug, ensure_direct_conversation, load_direct_conversation
from app.services.group_chat_defaults import ensure_group_chat_defaults
from app.services.server_icons import normalize_server_icon_asset
from app.services.site_presence import site_presence_manager
from app.services.workspace_events import ChannelUnreadState, load_unread_states_by_channel_id

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _first_text_channel(server: Server):
    text_channels = sorted(
        (channel for channel in server.channels if channel.type.value == "text"),
        key=lambda channel: (channel.position, channel.name.casefold()),
    )
    if not text_channels:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="У беседы нет текстового канала",
        )
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

    return server.name, f"{len(server.members)} участников"


def _build_message_preview(message: Message | None) -> str:
    if message is None:
        return "Сообщений пока нет"

    content = " ".join((message.content or "").split())
    if content:
        return content

    attachments_count = len(message.attachments)
    if attachments_count > 1:
        return f"Вложения: {attachments_count}"
    if attachments_count == 1:
        return "Вложение"

    return "Новое сообщение"


def _load_last_messages_by_channel_id(db: Session, channel_ids: list[UUID]) -> dict[UUID, Message]:
    if not channel_ids:
        return {}

    latest_message_subquery = (
        select(
            Message.channel_id.label("channel_id"),
            func.max(Message.created_at).label("last_created_at"),
        )
        .where(Message.channel_id.in_(channel_ids))
        .group_by(Message.channel_id)
        .subquery()
    )

    messages = db.execute(
        select(Message)
        .join(
            latest_message_subquery,
            and_(
                Message.channel_id == latest_message_subquery.c.channel_id,
                Message.created_at == latest_message_subquery.c.last_created_at,
            ),
        )
        .options(selectinload(Message.attachments))
        .order_by(Message.channel_id, Message.created_at.desc(), Message.id.desc())
    ).scalars().unique().all()

    last_messages: dict[UUID, Message] = {}
    for message in messages:
        last_messages.setdefault(message.channel_id, message)

    return last_messages


def _load_push_enabled_by_server_id(
    db: Session,
    server_ids: list[UUID],
    current_user_id: UUID,
) -> dict[UUID, bool]:
    if not server_ids:
        return {}

    rows = db.execute(
        select(ConversationPushSetting.server_id, ConversationPushSetting.push_enabled).where(
            ConversationPushSetting.user_id == current_user_id,
            ConversationPushSetting.server_id.in_(server_ids),
        )
    ).all()
    push_enabled_by_server_id = {server_id: push_enabled for server_id, push_enabled in rows}
    return {server_id: push_enabled_by_server_id.get(server_id, False) for server_id in server_ids}


def _build_conversation_summary(
    server: Server,
    membership: ServerMember,
    current_user_id: UUID,
    online_user_ids: set[UUID],
    last_messages_by_channel_id: dict[UUID, Message] | None = None,
    unread_states_by_channel_id: dict[UUID, ChannelUnreadState] | None = None,
    push_enabled_by_server_id: dict[UUID, bool] | None = None,
) -> ConversationSummary:
    title, _ = _conversation_title(server, current_user_id)
    primary_channel = _first_text_channel(server)
    subtitle = _build_message_preview((last_messages_by_channel_id or {}).get(primary_channel.id))
    unread_state = (unread_states_by_channel_id or {}).get(primary_channel.id)
    members = sorted(server.members, key=lambda member: ((member.user_id != current_user_id), member.user.username.casefold()))
    return ConversationSummary(
        id=server.id,
        kind=server.kind.value,
        title=title,
        subtitle=subtitle,
        icon_asset=server.icon_asset,
        icon_updated_at=server.icon_updated_at,
        member_role=membership.role.value,
        primary_channel_id=primary_channel.id,
        unread_count=getattr(unread_state, "unread_count", 0),
        mention_unread_count=getattr(unread_state, "mention_unread_count", 0),
        first_unread_message_id=getattr(unread_state, "first_unread_message_id", None),
        first_mention_unread_message_id=getattr(unread_state, "first_mention_unread_message_id", None),
        push_enabled=(push_enabled_by_server_id or {}).get(server.id, False),
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


def _has_accepted_friend_request(left_user_id: UUID, right_user_id: UUID, db: Session) -> bool:
    return (
        db.execute(
            select(FriendRequest.id).where(
                or_(
                    and_(
                        FriendRequest.requester_user_id == left_user_id,
                        FriendRequest.target_user_id == right_user_id,
                    ),
                    and_(
                        FriendRequest.requester_user_id == right_user_id,
                        FriendRequest.target_user_id == left_user_id,
                    ),
                ),
                FriendRequest.status == FriendRequestStatus.ACCEPTED,
            )
        ).scalar_one_or_none()
        is not None
    )


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
    primary_channel_ids = [_first_text_channel(membership.server).id for membership in memberships]
    server_ids = [membership.server.id for membership in memberships]
    last_messages_by_channel_id = _load_last_messages_by_channel_id(db, primary_channel_ids)
    unread_states_by_channel_id = load_unread_states_by_channel_id(db, primary_channel_ids, current_user.id)
    push_enabled_by_server_id = _load_push_enabled_by_server_id(db, server_ids, current_user.id)
    summaries = [
        _build_conversation_summary(
            membership.server,
            membership,
            current_user.id,
            online_user_ids,
            last_messages_by_channel_id,
            unread_states_by_channel_id,
            push_enabled_by_server_id,
        )
        for membership in memberships
    ]
    summaries.sort(key=lambda item: (0 if item.kind == ServerKind.DIRECT.value else 1, item.title.casefold()))
    return summaries


@router.get("/directory", response_model=list[ConversationDirectoryUserSummary])
def list_conversation_directory(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConversationDirectoryUserSummary]:
    memberships = db.execute(
        select(ServerMember)
        .join(Server, Server.id == ServerMember.server_id)
        .where(
            ServerMember.user_id == current_user.id,
            Server.kind == ServerKind.DIRECT,
        )
        .options(
            joinedload(ServerMember.server).selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalars().all()

    users_by_id: dict[UUID, User] = {}
    for membership in memberships:
        for member in membership.server.members:
            if member.user_id != current_user.id:
                users_by_id.setdefault(member.user_id, member.user)

    users = sorted(users_by_id.values(), key=lambda user: user.username.casefold())
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

    existing_server = load_direct_conversation(db, current_user.id, peer_user.id)
    if existing_server is not None:
        membership = next(member for member in existing_server.members if member.user_id == current_user.id)
        online_user_ids = site_presence_manager.online_user_ids([member.user_id for member in existing_server.members])
        primary_channel_id = _first_text_channel(existing_server).id
        unread_states_by_channel_id = load_unread_states_by_channel_id(db, [primary_channel_id], current_user.id)
        push_enabled_by_server_id = _load_push_enabled_by_server_id(db, [existing_server.id], current_user.id)
        return _build_conversation_summary(
            existing_server,
            membership,
            current_user.id,
            online_user_ids,
            unread_states_by_channel_id=unread_states_by_channel_id,
            push_enabled_by_server_id=push_enabled_by_server_id,
        )

    if not _has_accepted_friend_request(current_user.id, peer_user.id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Личный чат откроется только после подтверждения запроса в друзья",
        )

    created_server, created = ensure_direct_conversation(db, current_user, peer_user)
    db.commit()

    if created:
        publish_servers_changed_from_sync(reason="conversation_created")

    membership = next(member for member in created_server.members if member.user_id == current_user.id)
    online_user_ids = site_presence_manager.online_user_ids([member.user_id for member in created_server.members])
    primary_channel_id = _first_text_channel(created_server).id
    unread_states_by_channel_id = load_unread_states_by_channel_id(db, [primary_channel_id], current_user.id)
    push_enabled_by_server_id = _load_push_enabled_by_server_id(db, [created_server.id], current_user.id)
    return _build_conversation_summary(
        created_server,
        membership,
        current_user.id,
        online_user_ids,
        unread_states_by_channel_id=unread_states_by_channel_id,
        push_enabled_by_server_id=push_enabled_by_server_id,
    )


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
        slug=conversation_slug("group"),
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
    primary_channel_id = _first_text_channel(created_server).id
    unread_states_by_channel_id = load_unread_states_by_channel_id(db, [primary_channel_id], current_user.id)
    push_enabled_by_server_id = _load_push_enabled_by_server_id(db, [created_server.id], current_user.id)
    return _build_conversation_summary(
        created_server,
        membership,
        current_user.id,
        online_user_ids,
        unread_states_by_channel_id=unread_states_by_channel_id,
        push_enabled_by_server_id=push_enabled_by_server_id,
    )
