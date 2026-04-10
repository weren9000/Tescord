from __future__ import annotations

from datetime import datetime, timezone
import re
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies.auth import get_current_user
from app.db.models import Attachment, Channel, ChannelType, MemberRole, Message, Server, ServerBlock, ServerKind, ServerMember, User
from app.db.session import get_db
from app.schemas.workspace import (
    AddServerMemberRequest,
    BlockedServerSummary,
    ChannelSummary,
    CreateChannelRequest,
    CreateServerRequest,
    LeaveServerRequest,
    ServerMemberSummary,
    ServerSummary,
    UpdateServerIconRequest,
    VoiceChannelPresenceSummary,
    VoicePresenceParticipantSummary,
)
from app.services.app_events import (
    publish_channels_updated,
    publish_channels_updated_from_sync,
    publish_members_updated_from_sync,
    publish_servers_changed_from_sync,
)
from app.services.default_tavern import is_default_tavern_channel
from app.services.group_chat_defaults import ensure_group_chat_defaults
from app.services.attachment_storage import delete_stored_attachment
from app.services.server_access import get_accessible_server, is_server_blocked
from app.services.server_icons import get_default_server_icon_asset, normalize_server_icon_asset
from app.services.site_presence import site_presence_manager
from app.services.workspace_defaults import ensure_workspace_defaults
from app.services.workspace_events import list_server_channels_for_user
from app.services.voice_access import (
    can_view_voice_channel,
    ensure_voice_channel_owner_permission,
    list_voice_channel_access_map,
)
from app.services.voice_signaling import voice_signaling_manager

router = APIRouter(prefix="/servers", tags=["workspace"])

ALLOWED_SERVER_ICON_MIME_TYPES = {"image/png", "image/jpeg"}
MAX_SERVER_ICON_SIZE_BYTES = 2 * 1024 * 1024


def _slugify(value: str) -> str:
    slug = re.sub(r"[\W_]+", "-", value.casefold(), flags=re.UNICODE).strip("-")
    return slug or "group"


def _build_server_summary(server: Server, role: MemberRole, unread_count: int = 0) -> ServerSummary:
    return ServerSummary(
        id=server.id,
        name=server.name,
        slug=server.slug,
        description=server.description,
        icon_asset=server.icon_asset,
        icon_updated_at=server.icon_updated_at,
        member_role=role.value,
        kind=server.kind.value,
        unread_count=max(0, unread_count),
    )


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


def _build_blocked_server_summary(block: ServerBlock) -> BlockedServerSummary:
    return BlockedServerSummary(
        server_id=block.server.id,
        name=block.server.name,
        icon_asset=block.server.icon_asset,
        icon_updated_at=block.server.icon_updated_at,
        kind=block.server.kind.value,
        blocked_at=block.created_at,
    )


def _ensure_unique_slug(db: Session, base_slug: str) -> str:
    slug = base_slug
    counter = 2

    while db.execute(select(Server.id).where(Server.slug == slug)).scalar_one_or_none() is not None:
        slug = f"{base_slug}-{counter}"
        counter += 1

    return slug


def _get_server_channel_or_404(db: Session, server_id: UUID, channel_id: UUID) -> Channel:
    channel = db.get(Channel, channel_id)
    if channel is None or channel.server_id != server_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    return channel


def _ensure_manage_permission(membership: ServerMember | None, current_user: User) -> MemberRole:
    if current_user.is_admin:
        return membership.role if membership is not None else MemberRole.ADMIN

    if membership is None or membership.role not in {MemberRole.OWNER, MemberRole.ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления группой")

    return membership.role


def _ensure_workspace_manageable(server: Server) -> None:
    if server.kind != ServerKind.WORKSPACE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")


def _sanitize_filename(filename: str | None, fallback: str = "group-icon") -> str:
    if not filename:
        return fallback

    sanitized = filename.replace("\\", "/").split("/")[-1].strip()
    return sanitized or fallback


def _collect_server_attachment_storage_paths(db: Session, server_id: UUID) -> list[str]:
    return [
        path
        for path in db.execute(
            select(Attachment.storage_path)
            .join(Message, Message.id == Attachment.message_id)
            .join(Channel, Channel.id == Message.channel_id)
            .where(Channel.server_id == server_id, Attachment.storage_path.is_not(None))
        ).scalars().all()
        if path
    ]


@router.get("", response_model=list[ServerSummary])
def list_servers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ServerSummary]:
    servers = db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(Server.kind == ServerKind.WORKSPACE, ServerMember.user_id == current_user.id)
        .order_by(Server.name)
    ).scalars().all()
    member_roles = {
        server_id: role
        for server_id, role in db.execute(
            select(ServerMember.server_id, ServerMember.role)
            .join(Server, Server.id == ServerMember.server_id)
            .where(ServerMember.user_id == current_user.id, Server.kind == ServerKind.WORKSPACE)
        ).all()
    }

    summaries: list[ServerSummary] = []
    for server in servers:
        visible_channels = list_server_channels_for_user(db, server.id, current_user.id)
        unread_count = sum(channel.unread_count for channel in visible_channels)
        summaries.append(_build_server_summary(server, member_roles[server.id], unread_count))

    return summaries


@router.get("/blocked", response_model=list[BlockedServerSummary])
def list_blocked_servers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BlockedServerSummary]:
    blocks = db.execute(
        select(ServerBlock)
        .join(Server, Server.id == ServerBlock.server_id)
        .where(
            ServerBlock.user_id == current_user.id,
            Server.kind.in_((ServerKind.GROUP_CHAT, ServerKind.WORKSPACE)),
        )
        .options(joinedload(ServerBlock.server))
        .order_by(ServerBlock.created_at.desc())
    ).scalars().all()

    return [_build_blocked_server_summary(block) for block in blocks]


@router.post("", response_model=ServerSummary, status_code=status.HTTP_201_CREATED)
def create_server(
    payload: CreateServerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ServerSummary:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Название площадки не может быть пустым")

    description = payload.description.strip() if payload.description else None
    slug = _ensure_unique_slug(db, _slugify(name))

    server = Server(
        name=name,
        slug=slug,
        description=description,
        icon_asset=get_default_server_icon_asset(name),
        kind=ServerKind.WORKSPACE,
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
    ensure_workspace_defaults(db, server, created_by_id=current_user.id)
    db.commit()
    db.refresh(server)
    publish_servers_changed_from_sync(reason="server_created")

    return _build_server_summary(server, MemberRole.OWNER)


@router.patch("/{server_id}/icon", response_model=ServerSummary)
def update_server_icon(
    server_id: UUID,
    payload: UpdateServerIconRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ServerSummary:
    server, membership = get_accessible_server(db, server_id, current_user)
    role = _ensure_manage_permission(membership, current_user)

    try:
        server.icon_asset = normalize_server_icon_asset(payload.icon_asset)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    server.icon_filename = None
    server.icon_mime_type = None
    server.icon_size_bytes = None
    server.icon_content = None
    server.icon_updated_at = None
    db.commit()
    db.refresh(server)
    publish_servers_changed_from_sync(reason="server_icon_updated")
    return _build_server_summary(server, role)


@router.put("/{server_id}/icon-file", response_model=ServerSummary)
async def upload_server_icon_file(
    server_id: UUID,
    icon: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ServerSummary:
    server, membership = get_accessible_server(db, server_id, current_user)
    role = _ensure_manage_permission(membership, current_user)

    try:
        content_type = (icon.content_type or "").lower()
        if content_type not in ALLOWED_SERVER_ICON_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Поддерживаются только PNG и JPG иконки группы",
            )

        payload = await icon.read()
        if not payload:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл иконки пустой")
        if len(payload) > MAX_SERVER_ICON_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Иконка группы превышает лимит 2 МБ",
            )

        server.icon_asset = None
        server.icon_filename = _sanitize_filename(icon.filename)
        server.icon_mime_type = content_type
        server.icon_size_bytes = len(payload)
        server.icon_content = payload
        server.icon_updated_at = datetime.now(timezone.utc)
    finally:
        await icon.close()

    db.commit()
    db.refresh(server)
    publish_servers_changed_from_sync(reason="server_icon_uploaded")
    return _build_server_summary(server, role)


@router.get("/{server_id}/icon-file")
def read_server_icon_file(server_id: UUID, db: Session = Depends(get_db)) -> Response:
    server = db.get(Server, server_id)
    if server is None or server.icon_content is None or server.icon_mime_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Иконка группы не найдена")

    filename = server.icon_filename or "group-icon"
    return Response(
        content=server.icon_content,
        media_type=server.icon_mime_type,
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
        },
    )


@router.get("/{server_id}/channels", response_model=list[ChannelSummary])
def list_server_channels(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChannelSummary]:
    server, _ = get_accessible_server(db, server_id, current_user)
    if server.kind == ServerKind.GROUP_CHAT:
        ensure_group_chat_defaults(db, server)
        db.commit()
    elif server.kind == ServerKind.WORKSPACE:
        ensure_workspace_defaults(db, server)
        db.commit()
    return list_server_channels_for_user(db, server.id, current_user.id)


@router.get("/{server_id}/members", response_model=list[ServerMemberSummary])
def list_server_members(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ServerMemberSummary]:
    server, _ = get_accessible_server(db, server_id, current_user)
    rows = db.execute(
        select(ServerMember, User)
        .join(User, User.id == ServerMember.user_id)
        .where(ServerMember.server_id == server.id)
        .order_by(ServerMember.joined_at, User.username)
    ).all()
    online_user_ids = site_presence_manager.online_user_ids([user.id for _, user in rows])

    return [
        _build_server_member_summary(member, user, online_user_ids)
        for member, user in rows
    ]


@router.post("/{server_id}/members", response_model=ServerMemberSummary)
def add_server_member(
    server_id: UUID,
    payload: AddServerMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ServerMemberSummary:
    server, membership = get_accessible_server(db, server_id, current_user, allow_workspace_auto_join=False)
    if server.kind == ServerKind.DIRECT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя добавлять участников в личный чат")

    _ensure_manage_permission(membership, current_user)

    if payload.user_id is not None:
        user = db.get(User, payload.user_id)
    else:
        assert payload.user_public_id is not None
        user = db.execute(select(User).where(User.public_id == payload.user_public_id)).scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if server.kind in {ServerKind.GROUP_CHAT, ServerKind.WORKSPACE} and is_server_blocked(db, server.id, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь заблокировал эту группу и не может быть приглашен повторно",
        )

    existing_member = db.execute(
        select(ServerMember).where(ServerMember.server_id == server.id, ServerMember.user_id == user.id)
    ).scalar_one_or_none()
    if existing_member is None:
        if server.kind == ServerKind.GROUP_CHAT:
            members_count = db.execute(
                select(func.count(ServerMember.id)).where(ServerMember.server_id == server.id)
            ).scalar_one()
            if int(members_count or 0) >= 10:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="В группе не может быть больше 10 участников",
                )

        existing_member = ServerMember(
            server_id=server.id,
            user_id=user.id,
            role=MemberRole.MEMBER,
            nickname=user.username,
        )
        db.add(existing_member)
        db.flush()

    if server.kind == ServerKind.GROUP_CHAT:
        ensure_group_chat_defaults(db, server)
    elif server.kind == ServerKind.WORKSPACE:
        ensure_workspace_defaults(db, server)

    db.commit()
    db.refresh(existing_member)

    publish_members_updated_from_sync(server.id, reason="member_added")
    publish_servers_changed_from_sync(reason="server_member_added")

    online_user_ids = site_presence_manager.online_user_ids([user.id])
    return _build_server_member_summary(existing_member, user, online_user_ids)


@router.delete("/{server_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_server_member(
    server_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    server, membership = get_accessible_server(db, server_id, current_user, allow_workspace_auto_join=False)
    if server.kind == ServerKind.DIRECT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалять участников из личного чата")

    _ensure_manage_permission(membership, current_user)

    if current_user.id == user_id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалить себя из группы этим действием")

    member_to_remove = db.execute(
        select(ServerMember).where(ServerMember.server_id == server.id, ServerMember.user_id == user_id)
    ).scalar_one_or_none()
    if member_to_remove is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник группы не найден")

    if member_to_remove.role == MemberRole.OWNER and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя удалить создателя группы")

    db.delete(member_to_remove)
    db.commit()

    publish_members_updated_from_sync(server.id, reason="member_removed")
    publish_servers_changed_from_sync(reason="server_member_removed")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/blocked/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock_server(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    block = db.execute(
        select(ServerBlock).where(ServerBlock.server_id == server_id, ServerBlock.user_id == current_user.id)
    ).scalar_one_or_none()
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена в заблокированных")

    db.delete(block)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{server_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_server(
    server_id: UUID,
    payload: LeaveServerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    server, membership = get_accessible_server(db, server_id, current_user, allow_workspace_auto_join=False)
    if server.kind not in {ServerKind.GROUP_CHAT, ServerKind.WORKSPACE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выйти можно только из группы или площадки")

    is_owner = server.owner_id == current_user.id or (membership is not None and membership.role == MemberRole.OWNER)
    should_close_group = bool(payload.close_group)
    accusative_label = "площадку" if server.kind == ServerKind.WORKSPACE else "группу"
    nominative_label = "площадка" if server.kind == ServerKind.WORKSPACE else "группа"

    if is_owner:
        if should_close_group:
            voice_channel_ids = db.execute(
                select(Channel.id).where(Channel.server_id == server.id, Channel.type == ChannelType.VOICE)
            ).scalars().all()
            storage_paths = _collect_server_attachment_storage_paths(db, server.id)
            db.delete(server)
            db.commit()

            for channel_id in voice_channel_ids:
                await voice_signaling_manager.disconnect_channel_sessions(str(channel_id))
            for storage_path in storage_paths:
                delete_stored_attachment(storage_path)

            publish_servers_changed_from_sync(reason="server_closed")
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        if payload.new_owner_user_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Перед уходом нужно передать {accusative_label} новому владельцу или закрыть ее полностью",
            )

        if payload.new_owner_user_id == current_user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Новый владелец должен быть другим участником")

        next_owner_member = db.execute(
            select(ServerMember).where(
                ServerMember.server_id == server.id,
                ServerMember.user_id == payload.new_owner_user_id,
            )
        ).scalar_one_or_none()
        if next_owner_member is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Новый владелец {nominative_label} не найден")

        server.owner_id = payload.new_owner_user_id
        next_owner_member.role = MemberRole.OWNER
        if membership is not None:
            membership.role = MemberRole.MEMBER

    if payload.block_after_leave:
        existing_block = db.execute(
            select(ServerBlock).where(ServerBlock.server_id == server.id, ServerBlock.user_id == current_user.id)
        ).scalar_one_or_none()
        if existing_block is None:
            db.add(ServerBlock(server_id=server.id, user_id=current_user.id))

    if membership is not None:
        db.delete(membership)
    db.commit()

    publish_members_updated_from_sync(server.id, reason="member_left")
    publish_servers_changed_from_sync(reason="server_left")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post("/{server_id}/block", status_code=status.HTTP_204_NO_CONTENT)
async def block_server(
    server_id: UUID,
    payload: LeaveServerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    return await leave_server(
        server_id=server_id,
        payload=LeaveServerRequest(
            new_owner_user_id=payload.new_owner_user_id,
            close_group=payload.close_group,
            block_after_leave=True,
        ),
        current_user=current_user,
        db=db,
    )


@router.get("/{server_id}/voice-presence", response_model=list[VoiceChannelPresenceSummary])
async def list_server_voice_presence(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelPresenceSummary]:
    server, _ = get_accessible_server(db, server_id, current_user)
    if server.kind == ServerKind.GROUP_CHAT:
        ensure_group_chat_defaults(db, server)
        db.commit()
    elif server.kind == ServerKind.WORKSPACE:
        ensure_workspace_defaults(db, server)
        db.commit()
    voice_channels = db.execute(
        select(Channel)
        .where(Channel.server_id == server.id, Channel.type == ChannelType.VOICE)
        .order_by(Channel.position, Channel.name)
    ).scalars().all()

    voice_access_map = list_voice_channel_access_map(db, [channel.id for channel in voice_channels], current_user.id)
    visible_voice_channels = [
        channel for channel in voice_channels if can_view_voice_channel(voice_access_map.get(channel.id))
    ]

    if not visible_voice_channels:
        return []

    snapshot = await voice_signaling_manager.snapshot_rooms({str(channel.id) for channel in visible_voice_channels})

    return [
        _build_voice_channel_presence_summary(channel, snapshot[str(channel.id)])
        for channel in visible_voice_channels
        if str(channel.id) in snapshot
    ]


@router.post("/{server_id}/channels", response_model=ChannelSummary, status_code=status.HTTP_201_CREATED)
def create_server_channel(
    server_id: UUID,
    payload: CreateChannelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelSummary:
    server, membership = get_accessible_server(db, server_id, current_user)
    _ensure_workspace_manageable(server)
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
    db.flush()
    if channel.type == ChannelType.VOICE:
        ensure_voice_channel_owner_permission(db, channel)
    db.commit()
    db.refresh(channel)
    publish_channels_updated_from_sync(server.id, reason="channel_created")

    return _build_channel_summary(channel, "owner" if channel.type == ChannelType.VOICE else None)


@router.delete("/{server_id}/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server_channel(
    server_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    server, membership = get_accessible_server(db, server_id, current_user)
    _ensure_workspace_manageable(server)
    _ensure_manage_permission(membership, current_user)

    channel = _get_server_channel_or_404(db, server_id, channel_id)
    if server.kind == ServerKind.WORKSPACE and channel.type == ChannelType.TEXT and channel.position == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Системный текстовый канал Общий чат нельзя удалить из площадки",
        )

    if channel.type == ChannelType.VOICE:
        if is_default_tavern_channel(channel):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Системный голосовой канал Таверна нельзя удалить из площадки",
            )
        await voice_signaling_manager.disconnect_channel_sessions(str(channel.id))

    attachment_storage_paths = db.execute(
        select(Attachment.storage_path)
        .join(Message, Message.id == Attachment.message_id)
        .where(Message.channel_id == channel.id, Attachment.storage_path.is_not(None))
    ).scalars().all()

    db.delete(channel)
    db.commit()
    for storage_path in attachment_storage_paths:
        delete_stored_attachment(storage_path)
    await publish_channels_updated(server_id, reason="channel_deleted")

