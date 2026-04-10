from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user, resolve_user_from_token
from app.db.models import (
    Channel,
    ChannelType,
    MemberRole,
    Server,
    ServerMember,
    User,
    VoiceAccessRole,
    VoiceChannelAccess,
    VoiceJoinRequest,
    VoiceJoinRequestStatus,
)
from app.db.session import SessionLocal, get_db
from app.schemas.voice import (
    ResolveVoiceJoinRequest,
    VoiceAccessUserSummary,
    VoiceChannelAccessEntry,
    VoiceChannelAccessUpdateRequest,
    VoiceChannelCatalogItem,
    VoiceJoinRequestCreateResponse,
    VoiceJoinRequestSummary,
    VoiceOwnerMuteUpdateRequest,
)
from app.services.app_events import (
    publish_channels_updated,
    publish_channels_updated_from_sync,
    publish_members_updated,
    publish_members_updated_from_sync,
    publish_voice_inbox_changed,
    publish_voice_inbox_changed_from_sync,
    publish_voice_presence_updated,
    publish_voice_request_resolved,
)
from app.services.default_tavern import is_default_tavern_channel
from app.services.site_presence import site_presence_manager
from app.services.voice_access import (
    build_voice_join_gate,
    block_guest_access,
    can_join_voice_channel_directly,
    can_view_voice_channel,
    get_effective_voice_access_role,
    get_voice_channel_access,
    get_voice_channel_owner_access,
    grant_guest_temporary_access,
    is_platform_voice_manager,
    is_voice_access_blocked,
    mark_guest_rejoin_grace,
    utc_now,
)
from app.services.voice_signaling import voice_signaling_manager

router = APIRouter(prefix="/voice", tags=["voice"])


def _seconds_until(value, *, now=None) -> int:
    current_time = now or utc_now()
    remaining_seconds = int((value - current_time).total_seconds())
    return max(0, remaining_seconds)


def _format_retry_wait(seconds: int) -> str:
    minutes, remainder = divmod(max(0, seconds), 60)
    if minutes and remainder:
        return f"{minutes} мин {remainder} сек"
    if minutes:
        return f"{minutes} мин"
    return f"{remainder} сек"


def _build_blocked_voice_detail(*, blocked_until, now=None) -> dict[str, object]:
    retry_after_seconds = _seconds_until(blocked_until, now=now)
    return {
        "message": f"Повторить попытку можно через {_format_retry_wait(retry_after_seconds)}.",
        "blocked_until": blocked_until.isoformat(),
        "retry_after_seconds": retry_after_seconds,
    }


def _get_voice_channel_or_404(db: Session, channel_id: UUID) -> Channel:
    channel = db.get(Channel, channel_id)
    if channel is None or channel.type != ChannelType.VOICE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Голосовой канал не найден")

    return channel


def _ensure_server_membership(db: Session, channel: Channel, user: User) -> tuple[ServerMember, bool]:
    membership = db.execute(
        select(ServerMember).where(
            ServerMember.server_id == channel.server_id,
            ServerMember.user_id == user.id,
        )
    ).scalar_one_or_none()
    if membership is not None:
        return membership, False

    membership = ServerMember(
        server_id=channel.server_id,
        user_id=user.id,
        role=MemberRole.MEMBER,
        nickname=user.username,
    )
    db.add(membership)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        membership = db.execute(
            select(ServerMember).where(
                ServerMember.server_id == channel.server_id,
                ServerMember.user_id == user.id,
            )
        ).scalar_one()
        return membership, False
    else:
        db.refresh(membership)

    return membership, True


def _get_channel_membership(db: Session, channel: Channel, user_id: UUID) -> ServerMember | None:
    return db.execute(
        select(ServerMember).where(
            ServerMember.server_id == channel.server_id,
            ServerMember.user_id == user_id,
        )
    ).scalar_one_or_none()


def _is_platform_manager_for_channel(db: Session, channel: Channel, user_id: UUID) -> bool:
    membership = _get_channel_membership(db, channel, user_id)
    return membership is not None and is_platform_voice_manager(membership.role)


def _ensure_voice_channel_manager(
    db: Session,
    channel: Channel,
    current_user: User,
) -> tuple[ServerMember | None, VoiceChannelAccess | None, bool]:
    membership = _get_channel_membership(db, channel, current_user.id)
    access = get_voice_channel_access(db, channel.id, current_user.id)
    has_platform_scope = current_user.is_admin or (membership is not None and is_platform_voice_manager(membership.role))
    has_channel_scope = access is not None and access.role == VoiceAccessRole.OWNER
    if has_platform_scope or has_channel_scope:
        return membership, access, has_platform_scope

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="У вас нет прав на управление этим голосовым каналом")


def _collect_voice_inbox_recipient_ids(db: Session, channel_id: UUID) -> set[UUID]:
    channel = db.get(Channel, channel_id)
    if channel is None:
        return set()

    admin_user_ids = set(
        db.execute(select(User.id).where(User.is_admin.is_(True))).scalars().all()
    )
    platform_manager_user_ids = set(
        db.execute(
            select(ServerMember.user_id).where(
                ServerMember.server_id == channel.server_id,
                ServerMember.role.in_((MemberRole.OWNER, MemberRole.ADMIN)),
            )
        ).scalars().all()
    )
    owner_user_ids = set(
        db.execute(
            select(VoiceChannelAccess.user_id).where(
                VoiceChannelAccess.channel_id == channel_id,
                VoiceChannelAccess.role == VoiceAccessRole.OWNER,
            )
        ).scalars().all()
    )
    return admin_user_ids | platform_manager_user_ids | owner_user_ids


def _build_voice_channel_catalog_item(
    channel: Channel,
    server: Server,
    owner_access: VoiceChannelAccess | None,
    owner_user: User | None,
) -> VoiceChannelCatalogItem:
    return VoiceChannelCatalogItem(
        channel_id=channel.id,
        server_id=server.id,
        server_name=server.name,
        channel_name=channel.name,
        owner_user_id=owner_access.user_id if owner_access is not None else None,
        owner_nick=owner_user.username if owner_user is not None else None,
        owner_avatar_updated_at=owner_user.avatar_updated_at if owner_user is not None else None,
    )


def _build_voice_access_entry(access: VoiceChannelAccess, user: User) -> VoiceChannelAccessEntry:
    return VoiceChannelAccessEntry(
        user_id=user.id,
        login=user.email,
        nick=user.username,
        avatar_updated_at=user.avatar_updated_at,
        role=access.role.value,
        is_online=False,
        is_in_channel=False,
        muted=False,
        owner_muted=access.owner_muted,
        blocked_until=access.blocked_until,
        temporary_access_until=access.temporary_access_until,
    )


def _build_voice_join_request_summary(
    request: VoiceJoinRequest,
    channel: Channel,
    requester: User,
    access: VoiceChannelAccess | None = None,
) -> VoiceJoinRequestSummary:
    blocked_until = None
    retry_after_seconds = None
    if access is not None and access.role in {VoiceAccessRole.GUEST, VoiceAccessRole.STRANGER} and is_voice_access_blocked(access):
        blocked_until = access.blocked_until
        retry_after_seconds = _seconds_until(access.blocked_until)

    return VoiceJoinRequestSummary(
        id=request.id,
        channel_id=channel.id,
        channel_name=channel.name,
        requester_user_id=requester.id,
        requester_nick=requester.username,
        requester_avatar_updated_at=requester.avatar_updated_at,
        status=request.status.value,
        created_at=request.created_at,
        resolved_at=request.resolved_at,
        blocked_until=blocked_until,
        retry_after_seconds=retry_after_seconds,
    )


def _get_request_context(
    db: Session,
    request_id: UUID,
) -> tuple[VoiceJoinRequest, Channel, User]:
    request = db.get(VoiceJoinRequest, request_id)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запрос на вход не найден")

    channel = db.get(Channel, request.channel_id)
    requester = db.get(User, request.requester_user_id)
    if channel is None or requester is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запрос на вход больше недоступен")

    return request, channel, requester


def _is_channel_owner(db: Session, channel_id: UUID, user_id: UUID) -> bool:
    access = get_voice_channel_access(db, channel_id, user_id)
    return access is not None and access.role == VoiceAccessRole.OWNER


async def _load_channel_access_entries(db: Session, channel_id: UUID) -> list[VoiceChannelAccessEntry]:
    channel = _get_voice_channel_or_404(db, channel_id)
    member_rows = db.execute(
        select(ServerMember, User)
        .join(User, User.id == ServerMember.user_id)
        .where(ServerMember.server_id == channel.server_id)
        .order_by(User.username)
    ).all()
    access_rows = db.execute(
        select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id == channel_id)
    ).scalars().all()
    access_by_user_id = {access.user_id: access for access in access_rows}

    online_user_ids = site_presence_manager.online_user_ids([user.id for _, user in member_rows])
    channel_snapshot = await voice_signaling_manager.snapshot_rooms({str(channel_id)})
    participants = channel_snapshot.get(str(channel_id), [])
    participants_by_user_id = {
        UUID(str(participant["user_id"])): participant
        for participant in participants
    }

    entries = []
    for member, user in member_rows:
        access = access_by_user_id.get(user.id)
        effective_role = get_effective_voice_access_role(access, member.role) or VoiceAccessRole.STRANGER
        participant = participants_by_user_id.get(user.id)
        entries.append(
            VoiceChannelAccessEntry(
                user_id=user.id,
                login=user.email,
                nick=user.username,
                avatar_updated_at=user.avatar_updated_at,
                role=effective_role.value,
                is_online=user.id in online_user_ids,
                is_in_channel=participant is not None,
                muted=bool(participant["muted"]) if participant is not None else False,
                owner_muted=bool(participant.get("owner_muted", access.owner_muted if access is not None else False))
                if participant is not None
                else (access.owner_muted if access is not None else False),
                blocked_until=access.blocked_until if access is not None else None,
                temporary_access_until=access.temporary_access_until if access is not None else None,
            )
        )

    role_order = {"owner": 0, "resident": 1, "guest": 2, "stranger": 3}
    return sorted(
        entries,
        key=lambda item: (
            role_order.get(item.role, 99),
            0 if item.is_in_channel else 1,
            0 if item.is_online else 1,
            item.nick.casefold(),
        ),
    )


def _upsert_voice_access(
    db: Session,
    channel: Channel,
    user: User,
    role: VoiceAccessRole,
) -> VoiceChannelAccess:
    access = get_voice_channel_access(db, channel.id, user.id)
    if access is None:
        access = VoiceChannelAccess(
            channel_id=channel.id,
            user_id=user.id,
            role=role,
        )
        db.add(access)
    else:
        access.role = role

    if role in {VoiceAccessRole.OWNER, VoiceAccessRole.RESIDENT, VoiceAccessRole.GUEST}:
        access.blocked_until = None
        access.temporary_access_until = None

    if role == VoiceAccessRole.OWNER:
        access.owner_muted = False

    _ensure_server_membership(db, channel, user)
    db.flush()
    return access


@router.get("/admin/channels", response_model=list[VoiceChannelCatalogItem])
def list_all_voice_channels_for_admin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelCatalogItem]:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор может просматривать все голосовые каналы")

    rows = db.execute(
        select(Channel, Server)
        .join(Server, Server.id == Channel.server_id)
        .where(Channel.type == ChannelType.VOICE)
        .order_by(Server.name, Channel.position, Channel.name)
    ).all()

    results: list[VoiceChannelCatalogItem] = []
    for channel, server in rows:
        owner_access = get_voice_channel_owner_access(db, channel.id)
        owner_user = db.get(User, owner_access.user_id) if owner_access is not None else None
        results.append(_build_voice_channel_catalog_item(channel, server, owner_access, owner_user))

    return results


@router.get("/admin/users", response_model=list[VoiceAccessUserSummary])
def list_all_users_for_voice_admin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceAccessUserSummary]:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор может просматривать пользователей")

    users = db.execute(select(User).order_by(User.username)).scalars().all()
    online_user_ids = site_presence_manager.online_user_ids([user.id for user in users])
    return [
        VoiceAccessUserSummary(
            user_id=user.id,
            login=user.email,
            nick=user.username,
            avatar_updated_at=user.avatar_updated_at,
            is_online=user.id in online_user_ids,
        )
        for user in users
    ]


@router.get("/channels/{channel_id}/access", response_model=list[VoiceChannelAccessEntry])
async def list_voice_channel_access(
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelAccessEntry]:
    channel = _get_voice_channel_or_404(db, channel_id)
    _ensure_voice_channel_manager(db, channel, current_user)
    return await _load_channel_access_entries(db, channel.id)


@router.put("/channels/{channel_id}/access/{user_id}", response_model=list[VoiceChannelAccessEntry])
async def update_voice_channel_access(
    channel_id: UUID,
    user_id: UUID,
    payload: VoiceChannelAccessUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelAccessEntry]:
    channel = _get_voice_channel_or_404(db, channel_id)
    _, _, has_platform_scope = _ensure_voice_channel_manager(db, channel, current_user)
    if is_default_tavern_channel(channel):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="У канала Таверна доступ общий для всех и не редактируется вручную",
        )

    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    target_membership = _get_channel_membership(db, channel, user_id)
    if target_membership is not None and is_platform_voice_manager(target_membership.role) and not has_platform_scope:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя менять доступ создателя или администратора площадки из настроек канала",
        )

    current_access = get_voice_channel_access(db, channel.id, user_id)
    current_owner = get_voice_channel_owner_access(db, channel.id)

    if payload.role == "owner":
        if not has_platform_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Назначать владельца канала может только создатель площадки")

        if current_owner is not None and current_owner.user_id != user_id:
            current_owner.role = VoiceAccessRole.RESIDENT
            current_owner.owner_muted = False
            current_owner.blocked_until = None
            current_owner.temporary_access_until = None

        _upsert_voice_access(db, channel, target_user, VoiceAccessRole.OWNER)
        db.commit()
        entries = await _load_channel_access_entries(db, channel.id)
        await publish_channels_updated(channel.server_id, reason="voice_access_changed")
        await publish_voice_presence_updated(channel.server_id)
        return entries

    if payload.role is None:
        if current_access is None:
            return await _load_channel_access_entries(db, channel.id)

        if current_access.role == VoiceAccessRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя убрать владельца канала. Сначала назначьте нового владельца.",
            )

        db.delete(current_access)
        db.commit()
        entries = await _load_channel_access_entries(db, channel.id)
        await publish_channels_updated(channel.server_id, reason="voice_access_changed")
        await publish_voice_presence_updated(channel.server_id)
        return entries

    next_role = VoiceAccessRole(payload.role)
    if not has_platform_scope and next_role == VoiceAccessRole.OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Владелец канала не может назначать другого владельца")

    if current_access is not None and current_access.role == VoiceAccessRole.OWNER and next_role != VoiceAccessRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя понизить владельца канала. Сначала назначьте нового владельца.",
        )

    _upsert_voice_access(db, channel, target_user, next_role)
    db.commit()
    if next_role == VoiceAccessRole.STRANGER:
        await voice_signaling_manager.disconnect_user_sessions(str(channel.id), str(user_id))
    entries = await _load_channel_access_entries(db, channel.id)
    await publish_channels_updated(channel.server_id, reason="voice_access_changed")
    await publish_voice_presence_updated(channel.server_id)
    return entries


@router.post("/channels/{channel_id}/requests", response_model=VoiceJoinRequestCreateResponse)
def create_voice_join_request(
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceJoinRequestCreateResponse:
    channel = _get_voice_channel_or_404(db, channel_id)
    membership, membership_created = _ensure_server_membership(db, channel, current_user)
    if membership_created:
        publish_members_updated_from_sync(channel.server_id, reason="member_joined")

    access = get_voice_channel_access(db, channel.id, current_user.id)
    if access is None and is_default_tavern_channel(channel):
        access = VoiceChannelAccess(
            channel_id=channel.id,
            user_id=current_user.id,
            role=VoiceAccessRole.RESIDENT,
        )
        db.add(access)
        db.commit()
        db.refresh(access)

    gate = build_voice_join_gate(access, member_role=membership.role)
    if not gate.visible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="У вас нет доступа к этому голосовому каналу")

    if gate.can_join_directly:
        return VoiceJoinRequestCreateResponse(
            request=None,
            can_join_now=True,
            detail="Можно входить в канал без ожидания ответа владельца",
            blocked_until=None,
            retry_after_seconds=None,
        )

    if gate.blocked_until is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_build_blocked_voice_detail(blocked_until=gate.blocked_until),
        )

    owner_access = get_voice_channel_owner_access(db, channel.id)
    if owner_access is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="У этого голосового канала пока не назначен владелец",
        )

    existing_request = db.execute(
        select(VoiceJoinRequest)
        .where(
            VoiceJoinRequest.channel_id == channel.id,
            VoiceJoinRequest.requester_user_id == current_user.id,
            VoiceJoinRequest.status == VoiceJoinRequestStatus.PENDING,
        )
        .order_by(VoiceJoinRequest.created_at.desc())
    ).scalar_one_or_none()

    if existing_request is not None:
        return VoiceJoinRequestCreateResponse(
            request=_build_voice_join_request_summary(existing_request, channel, current_user),
            can_join_now=False,
            detail="Запрос уже отправлен владельцу канала",
            blocked_until=None,
            retry_after_seconds=None,
        )

    request = VoiceJoinRequest(
        channel_id=channel.id,
        requester_user_id=current_user.id,
        status=VoiceJoinRequestStatus.PENDING,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    publish_voice_inbox_changed_from_sync(_collect_voice_inbox_recipient_ids(db, channel.id))

    return VoiceJoinRequestCreateResponse(
        request=_build_voice_join_request_summary(request, channel, current_user),
        can_join_now=False,
        detail="Ожидайте ответа владельца",
        blocked_until=None,
        retry_after_seconds=None,
    )


@router.get("/requests/inbox", response_model=list[VoiceJoinRequestSummary])
def list_incoming_voice_join_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceJoinRequestSummary]:
    rows = db.execute(
        select(VoiceJoinRequest, Channel, User)
        .join(Channel, Channel.id == VoiceJoinRequest.channel_id)
        .join(User, User.id == VoiceJoinRequest.requester_user_id)
        .where(VoiceJoinRequest.status == VoiceJoinRequestStatus.PENDING)
        .order_by(VoiceJoinRequest.created_at)
    ).all()

    if current_user.is_admin:
        filtered_rows = rows
    else:
        owned_channel_ids = set(
            db.execute(
                select(VoiceChannelAccess.channel_id).where(
                    VoiceChannelAccess.user_id == current_user.id,
                    VoiceChannelAccess.role == VoiceAccessRole.OWNER,
                )
            ).scalars().all()
        )
        managed_server_ids = set(
            db.execute(
                select(ServerMember.server_id).where(
                    ServerMember.user_id == current_user.id,
                    ServerMember.role.in_((MemberRole.OWNER, MemberRole.ADMIN)),
                )
            ).scalars().all()
        )
        filtered_rows = [
            row for row in rows
            if row[1].id in owned_channel_ids or row[1].server_id in managed_server_ids
        ]

    return [
        _build_voice_join_request_summary(request, channel, requester)
        for request, channel, requester in filtered_rows
    ]


@router.get("/requests/{request_id}", response_model=VoiceJoinRequestSummary)
def get_voice_join_request(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceJoinRequestSummary:
    request, channel, requester = _get_request_context(db, request_id)

    if (
        not current_user.is_admin
        and requester.id != current_user.id
        and not _is_channel_owner(db, channel.id, current_user.id)
        and not _is_platform_manager_for_channel(db, channel, current_user.id)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="У вас нет доступа к этому запросу")

    access = get_voice_channel_access(db, channel.id, requester.id)
    return _build_voice_join_request_summary(request, channel, requester, access)


@router.post("/requests/{request_id}/resolve", response_model=VoiceJoinRequestSummary)
async def resolve_voice_join_request(
    request_id: UUID,
    payload: ResolveVoiceJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceJoinRequestSummary:
    request, channel, requester = _get_request_context(db, request_id)
    _ensure_voice_channel_manager(db, channel, current_user)

    if request.status != VoiceJoinRequestStatus.PENDING:
        return _build_voice_join_request_summary(request, channel, requester, get_voice_channel_access(db, channel.id, requester.id))

    access = get_voice_channel_access(db, channel.id, requester.id)
    if access is None:
        access = VoiceChannelAccess(
            channel_id=channel.id,
            user_id=requester.id,
            role=VoiceAccessRole.GUEST,
        )
        db.add(access)
        db.flush()

    now = utc_now()
    if payload.action == "allow":
        access.role = VoiceAccessRole.GUEST
        grant_guest_temporary_access(access, now=now)
        request.status = VoiceJoinRequestStatus.ALLOWED
    elif payload.action == "resident":
        access.role = VoiceAccessRole.RESIDENT
        access.blocked_until = None
        access.temporary_access_until = None
        request.status = VoiceJoinRequestStatus.RESIDENT
    else:
        access.role = VoiceAccessRole.GUEST
        block_guest_access(access, now=now)
        request.status = VoiceJoinRequestStatus.REJECTED
        await voice_signaling_manager.disconnect_user_sessions(str(channel.id), str(requester.id))

    request.resolved_at = now
    db.commit()
    db.refresh(request)
    request_summary = _build_voice_join_request_summary(request, channel, requester, access)
    await publish_voice_inbox_changed(_collect_voice_inbox_recipient_ids(db, channel.id))
    await publish_voice_request_resolved(requester.id, request_summary.model_dump(mode="json"))
    await publish_channels_updated(channel.server_id, reason="voice_access_changed")
    await publish_voice_presence_updated(channel.server_id)

    return request_summary


@router.post("/channels/{channel_id}/participants/{user_id}/kick", response_model=list[VoiceChannelAccessEntry])
async def kick_voice_participant(
    channel_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelAccessEntry]:
    channel = _get_voice_channel_or_404(db, channel_id)
    _ensure_voice_channel_manager(db, channel, current_user)

    access = get_voice_channel_access(db, channel.id, user_id)
    if access is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден в настройках канала")

    if access.role == VoiceAccessRole.OWNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя выгнать владельца канала")

    if access.role in {VoiceAccessRole.GUEST, VoiceAccessRole.STRANGER}:
        block_guest_access(access)
        db.commit()
    await voice_signaling_manager.disconnect_user_sessions(str(channel.id), str(user_id))
    await publish_channels_updated(channel.server_id, reason="voice_access_changed")
    await publish_voice_presence_updated(channel.server_id)
    return await _load_channel_access_entries(db, channel.id)


@router.put("/channels/{channel_id}/participants/{user_id}/owner-mute", response_model=list[VoiceChannelAccessEntry])
async def update_voice_participant_owner_mute(
    channel_id: UUID,
    user_id: UUID,
    payload: VoiceOwnerMuteUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VoiceChannelAccessEntry]:
    channel = _get_voice_channel_or_404(db, channel_id)
    _ensure_voice_channel_manager(db, channel, current_user)

    access = get_voice_channel_access(db, channel.id, user_id)
    if access is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден в настройках канала")

    if access.role == VoiceAccessRole.OWNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя заблокировать микрофон владельца канала")

    access.owner_muted = payload.owner_muted
    db.commit()

    await voice_signaling_manager.update_owner_mute_state(str(channel.id), str(user_id), access.owner_muted)
    await publish_voice_presence_updated(channel.server_id)
    return await _load_channel_access_entries(db, channel.id)


@router.websocket("/channels/{channel_id}/ws")
async def connect_to_voice_channel(websocket: WebSocket, channel_id: UUID) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    with SessionLocal() as db:
        try:
            current_user = resolve_user_from_token(token, db)
        except HTTPException:
            await websocket.close(code=4401, reason="Unauthorized")
            return

        try:
            channel = _get_voice_channel_or_404(db, channel_id)
        except HTTPException:
            await websocket.close(code=4404, reason="Voice channel not found")
            return

        membership, membership_created = _ensure_server_membership(db, channel, current_user)
        if membership_created:
            await publish_members_updated(channel.server_id, reason="member_joined")

        access = get_voice_channel_access(db, channel.id, current_user.id)
        if access is None and is_default_tavern_channel(channel):
            access = VoiceChannelAccess(
                channel_id=channel.id,
                user_id=current_user.id,
                role=VoiceAccessRole.RESIDENT,
            )
            db.add(access)
            db.commit()
            db.refresh(access)

        if not can_view_voice_channel(access, membership.role):
            await websocket.close(code=4403, reason="Нет доступа к голосовому каналу")
            return

        if not can_join_voice_channel_directly(access, member_role=membership.role):
            if is_voice_access_blocked(access):
                await websocket.close(code=4403, reason="Вход временно запрещен владельцем")
            else:
                await websocket.close(code=4403, reason="Ожидайте ответа владельца канала")
            return

        participant = await voice_signaling_manager.connect(
            websocket,
            str(channel.id),
            user_id=str(current_user.id),
            public_id=current_user.public_id,
            nick=current_user.username,
            avatar_updated_at=current_user.avatar_updated_at,
            owner_muted=bool(access.owner_muted) if access is not None else False,
        )
        await publish_voice_presence_updated(channel.server_id)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type in {"offer", "answer", "ice_candidate"}:
                target_id = message.get("target_id")
                if not isinstance(target_id, str) or not target_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать target_id"})
                    continue

                relayed = await voice_signaling_manager.relay(
                    str(channel_id),
                    source_id=participant.id,
                    target_id=target_id,
                    message_type=message_type,
                    payload=message.get("payload"),
                )
                if not relayed:
                    await websocket.send_json({"type": "error", "detail": "Участник уже отключился"})
                continue

            if message_type == "mute_state":
                await voice_signaling_manager.update_mute_state(
                    str(channel_id),
                    participant.id,
                    bool(message.get("muted")),
                )
                await publish_voice_presence_updated(channel.server_id)
                continue

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            await websocket.send_json(
                {
                    "type": "error",
                    "detail": f"Неподдерживаемый тип сообщения: {message_type!r}",
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await voice_signaling_manager.disconnect(str(channel_id), participant.id)
        with SessionLocal() as db:
            access = get_voice_channel_access(db, channel_id, current_user.id)
            if access is not None and access.role == VoiceAccessRole.GUEST and not is_voice_access_blocked(access):
                mark_guest_rejoin_grace(access)
                db.commit()
        await publish_voice_presence_updated(channel.server_id)
