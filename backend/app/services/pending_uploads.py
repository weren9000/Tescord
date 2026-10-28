"""Quota accounting and expiry of unpublished attachments."""
import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import select, func, text
from app.db.models import PendingUpload, Attachment, Message
from app.db.session import SessionLocal
from app.services.attachment_storage import delete_stored_attachment

def lock_owner(db, owner_id):
    if db.bind.dialect.name == 'postgresql':
        db.execute(text('SELECT pg_advisory_xact_lock(7281, :key)'),{'key':int.from_bytes(owner_id.bytes[:4],'big',signed=True)})

def used_storage(db, owner_id):
    published=db.scalar(select(func.coalesce(func.sum(Attachment.size_bytes),0)).join(Message,Message.id==Attachment.message_id).where(Message.author_id==owner_id,Attachment.deleted_at.is_(None)))
    pending=db.scalar(select(func.coalesce(func.sum(PendingUpload.size_bytes),0)).where(PendingUpload.owner_id==owner_id,PendingUpload.message_id.is_(None)))
    return published+pending

def cleanup_expired():
    with SessionLocal() as db:
        rows=db.scalars(select(PendingUpload).where(PendingUpload.expires_at<datetime.now(timezone.utc)).limit(100).with_for_update(skip_locked=True)).all()
        for row in rows:
            # Published attachment storage belongs to Attachment, never the expiring ticket.
            if row.message_id is None:delete_stored_attachment(row.storage_path)
            db.delete(row)
        db.commit()

async def run_upload_cleanup():
    while True:
        try:await asyncio.to_thread(cleanup_expired)
        except Exception:logging.getLogger(__name__).exception('Pending upload cleanup failed')
        await asyncio.sleep(300)
