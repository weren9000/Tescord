from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.core.config import get_settings
from app.db.models import ConversationPushSetting, PushSubscription, Server, ServerKind, ServerMember, User
from app.db.session import get_db
from app.schemas.push import (
    ConversationPushSettingRequest,
    ConversationPushSettingSummary,
    PushConfigResponse,
    PushSubscriptionUpsertRequest,
)

router = APIRouter(prefix="/push", tags=["push"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _load_accessible_conversation(
    db: Session,
    conversation_id: UUID,
    current_user: User,
) -> Server:
    conversation = db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(
            Server.id == conversation_id,
            Server.kind.in_((ServerKind.DIRECT, ServerKind.GROUP_CHAT)),
            ServerMember.user_id == current_user.id,
        )
    ).scalar_one_or_none()

    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Беседа не найдена")

    return conversation


@router.get("/config", response_model=PushConfigResponse)
def get_push_config() -> PushConfigResponse:
    settings = get_settings()
    return PushConfigResponse(
        enabled=settings.push_notifications_enabled,
        vapid_public_key=settings.push_vapid_public_key if settings.push_notifications_enabled else None,
    )


@router.post("/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def upsert_push_subscription(
    payload: PushSubscriptionUpsertRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    settings = get_settings()
    if not settings.push_notifications_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push-уведомления еще не настроены на сервере",
        )

    user_agent = payload.user_agent or request.headers.get("user-agent")
    subscription = db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    ).scalar_one_or_none()

    if subscription is None:
        subscription = PushSubscription(
            user_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=user_agent,
            last_seen_at=_utc_now(),
        )
        db.add(subscription)
    else:
        subscription.user_id = current_user.id
        subscription.p256dh = payload.keys.p256dh
        subscription.auth = payload.keys.auth
        subscription.user_agent = user_agent
        subscription.last_seen_at = _utc_now()

    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/conversations/{conversation_id}/setting",
    response_model=ConversationPushSettingSummary,
)
def update_conversation_push_setting(
    conversation_id: UUID,
    payload: ConversationPushSettingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationPushSettingSummary:
    _load_accessible_conversation(db, conversation_id, current_user)

    setting = db.execute(
        select(ConversationPushSetting).where(
            and_(
                ConversationPushSetting.user_id == current_user.id,
                ConversationPushSetting.server_id == conversation_id,
            )
        )
    ).scalar_one_or_none()

    if setting is None:
        setting = ConversationPushSetting(
            user_id=current_user.id,
            server_id=conversation_id,
            push_enabled=payload.push_enabled,
        )
        db.add(setting)
    else:
        setting.push_enabled = payload.push_enabled

    db.commit()
    return ConversationPushSettingSummary(
        conversation_id=conversation_id,
        push_enabled=payload.push_enabled,
    )
