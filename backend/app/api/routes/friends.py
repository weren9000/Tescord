from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies.auth import get_current_user
from app.db.models import Attachment, Channel, FriendBlock, FriendRequest, FriendRequestStatus, Message, User
from app.db.session import get_db
from app.schemas.friends import (
    BlockedFriendSummary,
    CreateFriendRequestRequest,
    FriendRequestsOverview,
    FriendRequestSummary,
    FriendRequestUserSummary,
)
from app.services.attachment_storage import delete_stored_attachment
from app.services.app_events import publish_friend_requests_changed_from_sync, publish_servers_changed_from_sync
from app.services.direct_conversations import ensure_direct_conversation, load_direct_conversation
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/friends", tags=["friends"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _pair_filter(left_user_id: UUID, right_user_id: UUID):
    return or_(
        and_(
            FriendRequest.requester_user_id == left_user_id,
            FriendRequest.target_user_id == right_user_id,
        ),
        and_(
            FriendRequest.requester_user_id == right_user_id,
            FriendRequest.target_user_id == left_user_id,
        ),
    )


def _resolve_target_user(payload: CreateFriendRequestRequest, current_user: User, db: Session) -> User:
    if payload.user_id is not None:
        if payload.user_id == current_user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя отправить запрос самому себе")

        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        return user

    assert payload.user_public_id is not None
    if payload.user_public_id == current_user.public_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя отправить запрос самому себе")

    user = db.execute(select(User).where(User.public_id == payload.user_public_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    return user


def _counterpart_user(request: FriendRequest, current_user_id: UUID) -> User:
    return request.requester if request.requester_user_id != current_user_id else request.target


def _build_request_summary(
    request: FriendRequest,
    current_user_id: UUID,
    online_user_ids: set[UUID],
) -> FriendRequestSummary:
    counterpart = _counterpart_user(request, current_user_id)
    direction = "incoming" if request.target_user_id == current_user_id else "outgoing"
    return FriendRequestSummary(
        id=request.id,
        status=request.status.value,
        direction=direction,
        created_at=request.created_at,
        responded_at=request.responded_at,
        user=FriendRequestUserSummary(
            user_id=counterpart.id,
            public_id=counterpart.public_id,
            login=counterpart.email,
            nick=counterpart.username,
            avatar_updated_at=counterpart.avatar_updated_at,
            is_online=counterpart.id in online_user_ids,
        ),
    )


def _build_blocked_friend_summary(block: FriendBlock, online_user_ids: set[UUID]) -> BlockedFriendSummary:
    user = block.blocked
    return BlockedFriendSummary(
        user_id=user.id,
        public_id=user.public_id,
        login=user.email,
        nick=user.username,
        avatar_updated_at=user.avatar_updated_at,
        is_online=user.id in online_user_ids,
        blocked_at=block.created_at,
    )


def _load_request_or_404(request_id: UUID, db: Session) -> FriendRequest:
    request = db.execute(
        select(FriendRequest)
        .where(FriendRequest.id == request_id)
        .options(
            joinedload(FriendRequest.requester),
            joinedload(FriendRequest.target),
        )
    ).scalar_one_or_none()
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запрос не найден")
    return request


def _load_friend_block(
    db: Session,
    *,
    blocker_user_id: UUID,
    blocked_user_id: UUID,
) -> FriendBlock | None:
    return db.execute(
        select(FriendBlock).where(
            FriendBlock.blocker_user_id == blocker_user_id,
            FriendBlock.blocked_user_id == blocked_user_id,
        )
    ).scalar_one_or_none()


def _has_friend_block(db: Session, left_user_id: UUID, right_user_id: UUID) -> bool:
    return (
        db.execute(
            select(FriendBlock.id).where(
                or_(
                    and_(
                        FriendBlock.blocker_user_id == left_user_id,
                        FriendBlock.blocked_user_id == right_user_id,
                    ),
                    and_(
                        FriendBlock.blocker_user_id == right_user_id,
                        FriendBlock.blocked_user_id == left_user_id,
                    ),
                )
            )
        ).scalar_one_or_none()
        is not None
    )


def _mark_friendship_requests_cancelled(
    db: Session,
    *,
    left_user_id: UUID,
    right_user_id: UUID,
    preserve_request_id: UUID | None = None,
    preserve_as_blocked: bool = False,
) -> None:
    requests = db.execute(
        select(FriendRequest).where(_pair_filter(left_user_id, right_user_id))
    ).scalars().all()

    now = _utc_now()
    for request in requests:
        if preserve_request_id is not None and request.id == preserve_request_id and preserve_as_blocked:
            request.status = FriendRequestStatus.BLOCKED
            request.responded_at = now
            continue

        if request.status != FriendRequestStatus.CANCELLED:
            request.status = FriendRequestStatus.CANCELLED
            request.responded_at = now


def _delete_direct_conversation_if_exists(db: Session, left_user_id: UUID, right_user_id: UUID) -> list[str]:
    direct_server = load_direct_conversation(db, left_user_id, right_user_id)
    if direct_server is None:
        return []

    storage_paths = db.execute(
        select(Attachment.storage_path)
        .join(Message, Message.id == Attachment.message_id)
        .join(Channel, Channel.id == Message.channel_id)
        .where(
            Channel.server_id == direct_server.id,
            Attachment.storage_path.is_not(None),
        )
    ).scalars().all()

    db.delete(direct_server)
    return [path for path in storage_paths if path]


def _cleanup_storage_paths(storage_paths: list[str]) -> None:
    for storage_path in storage_paths:
        delete_stored_attachment(storage_path)


@router.get("/requests", response_model=FriendRequestsOverview)
def list_friend_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestsOverview:
    requests = db.execute(
        select(FriendRequest)
        .where(
            or_(
                FriendRequest.requester_user_id == current_user.id,
                FriendRequest.target_user_id == current_user.id,
            ),
            FriendRequest.status == FriendRequestStatus.PENDING,
        )
        .options(
            joinedload(FriendRequest.requester),
            joinedload(FriendRequest.target),
        )
        .order_by(FriendRequest.created_at.desc())
    ).scalars().all()

    counterpart_ids = {
        request.requester_user_id if request.requester_user_id != current_user.id else request.target_user_id
        for request in requests
    }
    online_user_ids = site_presence_manager.online_user_ids(counterpart_ids)

    incoming: list[FriendRequestSummary] = []
    outgoing: list[FriendRequestSummary] = []
    for request in requests:
        summary = _build_request_summary(request, current_user.id, online_user_ids)
        if summary.direction == "incoming":
            incoming.append(summary)
        else:
            outgoing.append(summary)

    return FriendRequestsOverview(incoming=incoming, outgoing=outgoing)


@router.get("/blocked", response_model=list[BlockedFriendSummary])
def list_blocked_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BlockedFriendSummary]:
    blocks = db.execute(
        select(FriendBlock)
        .where(FriendBlock.blocker_user_id == current_user.id)
        .options(joinedload(FriendBlock.blocked))
        .order_by(FriendBlock.created_at.desc())
    ).scalars().all()

    online_user_ids = site_presence_manager.online_user_ids([block.blocked_user_id for block in blocks])
    return [_build_blocked_friend_summary(block, online_user_ids) for block in blocks]


@router.post("/requests", response_model=FriendRequestSummary, status_code=status.HTTP_201_CREATED)
def create_friend_request(
    payload: CreateFriendRequestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestSummary:
    target_user = _resolve_target_user(payload, current_user, db)

    if _has_friend_block(db, current_user.id, target_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Не удалось отправить запрос этому пользователю")

    if load_direct_conversation(db, current_user.id, target_user.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот пользователь уже у вас в друзьях")

    existing_requests = db.execute(
        select(FriendRequest)
        .where(_pair_filter(current_user.id, target_user.id))
        .options(
            joinedload(FriendRequest.requester),
            joinedload(FriendRequest.target),
        )
    ).scalars().all()

    now = _utc_now()
    reusable_request: FriendRequest | None = None
    for existing_request in existing_requests:
        same_direction = (
            existing_request.requester_user_id == current_user.id
            and existing_request.target_user_id == target_user.id
        )

        if existing_request.status == FriendRequestStatus.ACCEPTED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот пользователь уже у вас в друзьях")

        if existing_request.status == FriendRequestStatus.BLOCKED and _has_friend_block(db, current_user.id, target_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Не удалось отправить запрос этому пользователю")

        if same_direction and existing_request.status == FriendRequestStatus.PENDING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Запрос уже отправлен")

        if not same_direction and existing_request.status == FriendRequestStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Этот пользователь уже отправил вам запрос. Откройте уведомления.",
            )

        if same_direction and existing_request.status in (
            FriendRequestStatus.REJECTED,
            FriendRequestStatus.CANCELLED,
            FriendRequestStatus.BLOCKED,
        ):
            reusable_request = existing_request

    if reusable_request is None:
        request = FriendRequest(
            requester_user_id=current_user.id,
            target_user_id=target_user.id,
            status=FriendRequestStatus.PENDING,
        )
        db.add(request)
        db.flush()
    else:
        reusable_request.status = FriendRequestStatus.PENDING
        reusable_request.responded_at = None
        reusable_request.created_at = now
        reusable_request.updated_at = now
        request = reusable_request

    db.commit()
    request = _load_request_or_404(request.id, db)
    publish_friend_requests_changed_from_sync([current_user.id, target_user.id])

    return _build_request_summary(
        request,
        current_user.id,
        site_presence_manager.online_user_ids([target_user.id]),
    )


@router.post("/requests/{request_id}/accept", response_model=FriendRequestSummary)
def accept_friend_request(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestSummary:
    request = _load_request_or_404(request_id, db)
    if request.target_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя принять этот запрос")
    if request.status != FriendRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запрос уже обработан")
    if _has_friend_block(db, request.requester_user_id, request.target_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Этот запрос больше нельзя принять")

    request.status = FriendRequestStatus.ACCEPTED
    request.responded_at = _utc_now()
    _, created = ensure_direct_conversation(db, request.requester, request.target)
    db.commit()

    request = _load_request_or_404(request.id, db)
    publish_friend_requests_changed_from_sync([request.requester_user_id, request.target_user_id])
    if created:
        publish_servers_changed_from_sync(reason="friend_request_accepted")

    return _build_request_summary(
        request,
        current_user.id,
        site_presence_manager.online_user_ids([request.requester_user_id]),
    )


@router.post("/requests/{request_id}/reject", response_model=FriendRequestSummary)
def reject_friend_request(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestSummary:
    request = _load_request_or_404(request_id, db)
    if request.target_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя отклонить этот запрос")
    if request.status != FriendRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запрос уже обработан")

    request.status = FriendRequestStatus.REJECTED
    request.responded_at = _utc_now()
    db.commit()

    request = _load_request_or_404(request.id, db)
    publish_friend_requests_changed_from_sync([request.requester_user_id, request.target_user_id])
    return _build_request_summary(
        request,
        current_user.id,
        site_presence_manager.online_user_ids([request.requester_user_id]),
    )


@router.post("/requests/{request_id}/block", response_model=FriendRequestSummary)
def block_friend_request(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestSummary:
    request = _load_request_or_404(request_id, db)
    if request.target_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя заблокировать этот запрос")
    if request.status != FriendRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запрос уже обработан")

    if _load_friend_block(db, blocker_user_id=current_user.id, blocked_user_id=request.requester_user_id) is None:
        db.add(FriendBlock(blocker_user_id=current_user.id, blocked_user_id=request.requester_user_id))

    storage_paths = _delete_direct_conversation_if_exists(db, current_user.id, request.requester_user_id)
    _mark_friendship_requests_cancelled(
        db,
        left_user_id=current_user.id,
        right_user_id=request.requester_user_id,
        preserve_request_id=request.id,
        preserve_as_blocked=True,
    )
    db.commit()

    _cleanup_storage_paths(storage_paths)
    request = _load_request_or_404(request.id, db)
    publish_friend_requests_changed_from_sync([request.requester_user_id, request.target_user_id])
    publish_servers_changed_from_sync(reason="friend_blocked")
    return _build_request_summary(
        request,
        current_user.id,
        site_presence_manager.online_user_ids([request.requester_user_id]),
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_friend(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалить самого себя из друзей")

    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    direct_server = load_direct_conversation(db, current_user.id, user_id)
    accepted_request = db.execute(
        select(FriendRequest.id).where(
            _pair_filter(current_user.id, user_id),
            FriendRequest.status == FriendRequestStatus.ACCEPTED,
        )
    ).scalar_one_or_none()
    if direct_server is None and accepted_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден в друзьях")

    storage_paths = _delete_direct_conversation_if_exists(db, current_user.id, user_id)
    _mark_friendship_requests_cancelled(db, left_user_id=current_user.id, right_user_id=user_id)
    db.commit()

    _cleanup_storage_paths(storage_paths)
    publish_friend_requests_changed_from_sync([current_user.id, user_id])
    publish_servers_changed_from_sync(reason="friend_removed")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def block_friend(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя заблокировать самого себя")

    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if _load_friend_block(db, blocker_user_id=current_user.id, blocked_user_id=user_id) is None:
        db.add(FriendBlock(blocker_user_id=current_user.id, blocked_user_id=user_id))

    storage_paths = _delete_direct_conversation_if_exists(db, current_user.id, user_id)
    _mark_friendship_requests_cancelled(db, left_user_id=current_user.id, right_user_id=user_id)
    db.commit()

    _cleanup_storage_paths(storage_paths)
    publish_friend_requests_changed_from_sync([current_user.id, user_id])
    publish_servers_changed_from_sync(reason="friend_blocked")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/blocked/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock_friend(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    block = _load_friend_block(db, blocker_user_id=current_user.id, blocked_user_id=user_id)
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден в заблокированных")

    db.delete(block)
    db.commit()
    publish_friend_requests_changed_from_sync([current_user.id, user_id])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
