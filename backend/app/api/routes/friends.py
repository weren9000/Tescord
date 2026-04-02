from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies.auth import get_current_user
from app.db.models import FriendRequest, FriendRequestStatus, User
from app.db.session import get_db
from app.schemas.friends import (
    CreateFriendRequestRequest,
    FriendRequestsOverview,
    FriendRequestSummary,
    FriendRequestUserSummary,
)
from app.services.app_events import publish_friend_requests_changed_from_sync, publish_servers_changed_from_sync
from app.services.direct_conversations import ensure_direct_conversation, load_direct_conversation
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/friends", tags=["friends"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


@router.post("/requests", response_model=FriendRequestSummary, status_code=status.HTTP_201_CREATED)
def create_friend_request(
    payload: CreateFriendRequestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendRequestSummary:
    target_user = _resolve_target_user(payload, current_user, db)

    if load_direct_conversation(db, current_user.id, target_user.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот пользователь уже у вас в друзьях")

    existing_requests = db.execute(
        select(FriendRequest)
        .where(
            or_(
                and_(
                    FriendRequest.requester_user_id == current_user.id,
                    FriendRequest.target_user_id == target_user.id,
                ),
                and_(
                    FriendRequest.requester_user_id == target_user.id,
                    FriendRequest.target_user_id == current_user.id,
                ),
            )
        )
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
        if existing_request.status == FriendRequestStatus.BLOCKED:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Не удалось отправить запрос этому пользователю")
        if same_direction and existing_request.status == FriendRequestStatus.PENDING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Запрос уже отправлен")
        if not same_direction and existing_request.status == FriendRequestStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Этот пользователь уже отправил вам запрос. Откройте уведомления.",
            )
        if same_direction and existing_request.status in (FriendRequestStatus.REJECTED, FriendRequestStatus.CANCELLED):
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

    request.status = FriendRequestStatus.BLOCKED
    request.responded_at = _utc_now()
    db.commit()

    request = _load_request_or_404(request.id, db)
    publish_friend_requests_changed_from_sync([request.requester_user_id, request.target_user_id])
    return _build_request_summary(
        request,
        current_user.id,
        site_presence_manager.online_user_ids([request.requester_user_id]),
    )
