"""Durable notification delivery; a failed recipient cannot fail message creation."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import select

from app.db.models import OutboxEvent
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def _claim() -> list[UUID]:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        rows = db.execute(select(OutboxEvent).where(
            OutboxEvent.delivered_at.is_(None), OutboxEvent.available_at <= now,
        ).order_by(OutboxEvent.available_at).with_for_update(skip_locked=True).limit(20)).scalars().all()
        for row in rows:
            row.available_at = now + timedelta(seconds=60)
            row.attempts += 1
        ids = [row.id for row in rows]
        db.commit()
        return ids


def _payload(event_id: UUID):
    from app.api.routes.messages import _load_message, _build_message_summary
    with SessionLocal() as db:
        event = db.get(OutboxEvent, event_id)
        if event is None:
            return None
        message = _load_message(db, event.message_id)
        if message is None:
            return None
        return (message.channel.server_id, _build_message_summary(message, message.author_id).model_dump(mode="json"),
                dict(server_id=message.channel.server_id, author_id=message.author_id,
                     author_nick=message.author.username, content=message.content,
                     attachments_count=len(message.attachments)))


def _finish(event_id: UUID, success: bool):
    with SessionLocal() as db:
        event = db.get(OutboxEvent, event_id)
        if event is None:
            return
        now = datetime.now(timezone.utc)
        if success:
            event.delivered_at = now
        else:
            event.available_at = now + timedelta(seconds=min(300, 2 ** min(event.attempts, 8)))
        db.commit()


async def dispatch_once() -> int:
    from app.services.app_events import publish_message_created
    from app.services.push_notifications import publish_message_push_notifications
    ids = await asyncio.to_thread(_claim)

    async def deliver(event_id):
        try:
            payload = await asyncio.to_thread(_payload, event_id)
            if payload:
                async with asyncio.timeout(15):
                    await publish_message_created(payload[0], payload[1])
                    await publish_message_push_notifications(**payload[2])
            await asyncio.to_thread(_finish, event_id, True)
        except Exception:
            logger.warning("Outbox delivery deferred for event %s", event_id)
            await asyncio.to_thread(_finish, event_id, False)

    await asyncio.gather(*(deliver(event_id) for event_id in ids))
    return len(ids)


async def run_message_outbox():
    while True:
        try:
            await dispatch_once()
        except Exception:
            logger.exception("Message outbox iteration failed")
        await asyncio.sleep(0.25)
