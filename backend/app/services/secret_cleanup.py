"""Erase delivery queues and opaque files once their device session is gone."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, or_, select

from app.db.models import AuthSession
from app.db.secret_chats import SecretChat, SecretDevice, SecretEnvelope, SecretPrekey, SecretUpload, MediaCryptoDevice
from app.db.session import SessionLocal
from app.services.attachment_storage import resolve_attachment_path


def remove_upload_files(upload):
    folder = resolve_attachment_path(f'secret/{upload.id}/placeholder').parent
    for index in range(upload.chunk_count):
        (folder / f'{upload.id}.{index}.bin').unlink(missing_ok=True)
    try:
        folder.rmdir()
    except OSError:
        pass


def cleanup_secret_data():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.execute(delete(MediaCryptoDevice).where(MediaCryptoDevice.seen_at < now-timedelta(minutes=5)))
        dead = select(SecretDevice.id).join(AuthSession, SecretDevice.auth_session_id == AuthSession.id).where(
            or_(SecretDevice.revoked.is_(True), AuthSession.revoked_at.is_not(None)))
        for chat in db.scalars(select(SecretChat).where(SecretChat.closed_at.is_(None),
            or_(SecretChat.initiator_id.in_(dead), SecretChat.recipient_id.in_(dead))).limit(200).with_for_update(skip_locked=True)):
            chat.closed_at = now
        db.flush()
        closed = select(SecretChat.id).where(SecretChat.closed_at.is_not(None))
        uploads = db.scalars(select(SecretUpload).where(or_(SecretUpload.chat_id.in_(closed),
            SecretUpload.published.is_(False) & (SecretUpload.created_at < now-timedelta(days=1))))
            .limit(100).with_for_update(skip_locked=True)).all()
        for upload in uploads:
            remove_upload_files(upload)
            db.delete(upload)
        db.execute(delete(SecretEnvelope).where(SecretEnvelope.chat_id.in_(closed)))
        db.execute(delete(SecretPrekey).where(SecretPrekey.device_id.in_(dead)))
        db.commit()
        # Account/session FK cascades can remove metadata first. Clean only the
        # application-owned UUID directories, after a grace period for new writes.
        root = resolve_attachment_path('secret/placeholder').parent
        if root.is_dir():
            for folder in root.iterdir():
                try:
                    upload_id = UUID(folder.name)
                except ValueError:
                    continue
                if folder.is_symlink() or not folder.is_dir() or folder.stat().st_mtime >= (now-timedelta(days=1)).timestamp() or db.get(SecretUpload,upload_id):
                    continue
                for file in folder.iterdir():
                    if file.is_file() and not file.is_symlink() and file.name.startswith(str(upload_id)+'.') and file.suffix in {'.bin','.part'}:
                        file.unlink(missing_ok=True)
                try:
                    folder.rmdir()
                except OSError:
                    pass
