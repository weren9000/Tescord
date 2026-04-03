from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import ConversationPushSetting, PushSubscription, Server, ServerKind, ServerMember, User
from app.db.session import SessionLocal
from app.services.app_events import app_event_manager

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class PushDeliveryTarget:
    subscription_id: UUID
    endpoint: str
    p256dh: str
    auth: str


def _message_preview(content: str, attachments_count: int) -> str:
    normalized = " ".join((content or "").split())
    if normalized:
        return normalized
    if attachments_count > 1:
        return f"Вложения: {attachments_count}"
    if attachments_count == 1:
        return "Вложение"
    return "Новое сообщение"


def _notifications_enabled() -> bool:
    settings = get_settings()
    if not settings.push_notifications_enabled:
        return False

    private_key_path = Path(settings.push_vapid_private_key_path or "")
    return private_key_path.is_file()


def _build_push_payload(
    *,
    server: Server,
    author_nick: str,
    content: str,
    attachments_count: int,
) -> dict[str, object]:
    preview = _message_preview(content, attachments_count)
    if server.kind == ServerKind.DIRECT:
        title = author_nick
        body = preview
    else:
        title = server.name
        body = f"{author_nick}: {preview}"

    return {
        "title": title,
        "body": body,
        "conversationId": str(server.id),
        "url": f"/?pushConversation={server.id}",
        "tag": f"conversation-{server.id}",
        "icon": "/assets/Icons.png",
        "badge": "/assets/Icons.png",
    }


def _send_web_push(
    *,
    target: PushDeliveryTarget,
    payload: dict[str, object],
) -> tuple[bool, int | None]:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush is not installed; push notifications are disabled")
        return False, None

    settings = get_settings()
    try:
        webpush(
            subscription_info={
                "endpoint": target.endpoint,
                "keys": {
                    "p256dh": target.p256dh,
                    "auth": target.auth,
                },
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.push_vapid_private_key_path,
            vapid_claims={"sub": settings.push_vapid_subject},
        )
        return True, None
    except WebPushException as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("Push delivery failed for subscription %s: %s", target.subscription_id, exc)
        return False, status_code
    except Exception:
        logger.exception("Unexpected push delivery failure for subscription %s", target.subscription_id)
        return False, None


def _collect_push_targets(
    db: Session,
    *,
    server_id: UUID,
    author_id: UUID,
    active_user_ids: set[str],
) -> tuple[Server | None, list[PushDeliveryTarget]]:
    server = db.execute(
        select(Server).where(
            Server.id == server_id,
            Server.kind.in_((ServerKind.DIRECT, ServerKind.GROUP_CHAT)),
        )
    ).scalar_one_or_none()
    if server is None:
        return None, []

    rows = db.execute(
        select(PushSubscription)
        .join(ServerMember, ServerMember.user_id == PushSubscription.user_id)
        .join(
            ConversationPushSetting,
            and_(
                ConversationPushSetting.user_id == PushSubscription.user_id,
                ConversationPushSetting.server_id == server_id,
            ),
        )
        .where(
            ServerMember.server_id == server_id,
            PushSubscription.user_id != author_id,
            ConversationPushSetting.push_enabled.is_(True),
        )
    ).scalars().all()

    targets = [
        PushDeliveryTarget(
            subscription_id=row.id,
            endpoint=row.endpoint,
            p256dh=row.p256dh,
            auth=row.auth,
        )
        for row in rows
        if str(row.user_id) not in active_user_ids
    ]
    return server, targets


async def publish_message_push_notifications(
    *,
    server_id: UUID,
    author_id: UUID,
    author_nick: str,
    content: str,
    attachments_count: int,
) -> None:
    if not _notifications_enabled():
        return

    active_user_ids = await app_event_manager.get_server_subscriber_user_ids(server_id)
    with SessionLocal() as db:
        server, targets = _collect_push_targets(
            db,
            server_id=server_id,
            author_id=author_id,
            active_user_ids=active_user_ids,
        )

    if server is None or not targets:
        return

    payload = _build_push_payload(
        server=server,
        author_nick=author_nick,
        content=content,
        attachments_count=attachments_count,
    )

    results = await asyncio.gather(
        *[
            asyncio.to_thread(_send_web_push, target=target, payload=payload)
            for target in targets
        ],
        return_exceptions=True,
    )

    stale_subscription_ids: list[UUID] = []
    for target, result in zip(targets, results, strict=False):
        if isinstance(result, Exception):
            logger.exception("Push delivery task failed for subscription %s", target.subscription_id, exc_info=result)
            continue

        delivered, status_code = result
        if not delivered and status_code in {404, 410}:
            stale_subscription_ids.append(target.subscription_id)

    if stale_subscription_ids:
        with SessionLocal() as db:
            subscriptions = db.execute(
                select(PushSubscription).where(PushSubscription.id.in_(stale_subscription_ids))
            ).scalars().all()
            for subscription in subscriptions:
                db.delete(subscription)
            db.commit()
