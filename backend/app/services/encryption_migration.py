"""Resumable backfill/rotation, invoked during a maintenance window.

Each file is read back and authenticated before switching its DB pointer.
Plaintext cleanup is journaled in the same transaction and retried after crashes.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from sqlalchemy import func, select
from app.core.config import get_settings
from app.db.models import Attachment, EncryptionCleanup, Message, PendingUpload, RoomMessage, RoomUpload
from app.services.attachment_storage import resolve_attachment_path, _storage_relative_path
from app.services.attachment_previews import delete_preview
from app.services.data_encryption import check_database_keys, required_keyring
from app.services.encrypted_files import CHUNK, StoredReader, encrypted_path, is_encrypted, write_file
from app.services.meeting_rooms import files_root, upload_path


def verify_file(path: Path, expected_size: int, expected_hash: str | None = None):
    digest, total = sha256(), 0
    with StoredReader(path) as source:
        while chunk := source.read(CHUNK):
            total += len(chunk)
            digest.update(chunk)
    if total != expected_size or expected_hash and digest.hexdigest() != expected_hash:
        raise RuntimeError('Storage integrity verification failed')


def cleanup(db):
    for entry in db.scalars(select(EncryptionCleanup).with_for_update()).all():
        if entry.storage_kind == 'attachment':
            path = resolve_attachment_path(entry.relative_path)
        elif entry.storage_kind == 'room':
            root = files_root('00000000-0000-0000-0000-000000000000').parent.resolve()
            path = (root / entry.relative_path).resolve()
            if path == root or not path.is_relative_to(root):
                raise RuntimeError('Invalid cleanup path')
        else:
            raise RuntimeError('Unknown cleanup storage kind')
        delete_preview(path)
        path.unlink(missing_ok=True)
        db.delete(entry)
    db.commit()


def migrate(db, *, rotate=False, batch_size=100):
    ring = required_keyring()
    check_database_keys(db)
    db.commit()
    cleanup(db)
    counts = {'messages':0, 'room_messages':0, 'files':0}
    for model in (Message, RoomMessage):
        cursor = None
        while True:
            query = select(model).order_by(model.id).limit(batch_size).with_for_update()
            if cursor is not None:
                query = query.where(model.id > cursor)
            if not rotate:
                query = query.where(model.encrypted_content.is_(None))
            rows = db.scalars(query).all()
            if not rows:
                db.rollback()
                break
            for row in rows:
                cursor = row.id
                if row.encrypted_content is not None and row.encrypted_content[4:20].hex() == ring.active:
                    continue
                row.content = row.content
                counts[model.__tablename__] += 1
            db.commit()
    for model in (Attachment, PendingUpload, RoomUpload):
        cursor = None
        while True:
            query = select(model).order_by(model.id).limit(1).with_for_update()
            if cursor is not None:
                query = query.where(model.id > cursor)
            row = db.scalar(query)
            if row is None:
                db.rollback()
                break
            cursor = row.id
            if isinstance(row, RoomUpload):
                original = upload_path(row)
            elif row.storage_path:
                original = resolve_attachment_path(row.storage_path)
            elif isinstance(row, Attachment) and row.content is not None:
                original = None
            else:
                db.rollback()
                continue
            if original is not None and is_encrypted(original) and not rotate:
                verify_file(original, row.size_bytes, getattr(row, 'checksum_sha256', None))
                db.rollback()
                continue
            if original is None:
                destination = encrypted_path(resolve_attachment_path(_storage_relative_path(row.id, row.filename).as_posix()))
                source = BytesIO(row.content)
            else:
                destination = original if is_encrypted(original) else encrypted_path(original)
                source = StoredReader(original)
            with source:
                size, digest = write_file(source, destination, max_bytes=row.size_bytes, close_source=True)
            verify_file(destination, row.size_bytes, getattr(row, 'checksum_sha256', None) or digest)
            if rotate:
                # Recreate previews lazily under the active key; old encrypted
                # previews must not keep an otherwise retired key in use.
                delete_preview(destination)
            if isinstance(row, RoomUpload):
                row.storage_encrypted = True
                kind = 'room'
                relative = f'{row.session_id}/{row.id}'
            else:
                kind = 'attachment'
                relative = row.storage_path
                if original is None:
                    row.storage_path = _storage_relative_path(row.id, row.filename).as_posix()+'.kvaenc'
                elif not is_encrypted(original):
                    row.storage_path += '.kvaenc'
                if isinstance(row, Attachment):
                    row.content = None
            if original is not None and original != destination:
                db.add(EncryptionCleanup(storage_kind=kind, relative_path=relative))
            db.commit()
            cleanup(db)
            counts['files'] += 1
    return counts


def status(db):
    result = {}
    for model in (Message, RoomMessage):
        result[model.__tablename__+'_plaintext'] = db.scalar(select(func.count()).select_from(model).where(model.encrypted_content.is_(None)))
    result['cleanup_pending'] = db.scalar(select(func.count()).select_from(EncryptionCleanup))
    for model in (Attachment, PendingUpload):
        result[model.__tablename__+'_legacy_files'] = db.scalar(select(func.count()).select_from(model).where(model.storage_path.is_not(None), ~model.storage_path.endswith('.kvaenc')))
    result['attachment_blobs'] = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.content.is_not(None)))
    result['room_files_plaintext'] = db.scalar(select(func.count()).select_from(RoomUpload).where(RoomUpload.storage_encrypted.is_(False)))
    return result


def verify(db):
    check_database_keys(db)
    counts = {'messages':0, 'files':0}
    for model in (Message, RoomMessage):
        for row in db.scalars(select(model).execution_options(yield_per=100)):
            if row.encrypted_content is None:
                raise RuntimeError('Plaintext messages remain')
            row.content  # Authentication and context check, never printed.
            counts['messages'] += 1
    for model in (Attachment, PendingUpload, RoomUpload):
        for row in db.scalars(select(model).execution_options(yield_per=100)):
            if isinstance(row, RoomUpload):
                path = upload_path(row)
            elif row.storage_path:
                path = resolve_attachment_path(row.storage_path)
            elif isinstance(row, Attachment) and row.content is not None:
                raise RuntimeError('Plaintext attachment blobs remain')
            else:
                continue
            if not is_encrypted(path):
                raise RuntimeError('Plaintext files remain')
            verify_file(path, row.size_bytes, getattr(row, 'checksum_sha256', None))
            from app.services.attachment_previews import preview_paths
            preview, _ = preview_paths(path)
            if preview.exists():
                with StoredReader(preview) as stream:
                    while stream.read(CHUNK):
                        pass
            counts['files'] += 1
    if status(db)['cleanup_pending']:
        raise RuntimeError('Plaintext cleanup is incomplete')
    return counts
