from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile

from app.core.config import get_settings
from app.services.data_encryption import keyring
from app.services.encrypted_files import encrypted_path, write_file, FileTooLarge

CHUNK_SIZE_BYTES = 1024 * 1024


class AttachmentTooLargeError(Exception):
    pass


@dataclass(frozen=True)
class StoredAttachment:
    filename: str
    mime_type: str
    storage_path: str
    size_bytes: int
    checksum_sha256: str


def _uploads_root() -> Path:
    uploads_dir = Path(get_settings().uploads_dir).expanduser()
    if not uploads_dir.is_absolute():
        uploads_dir = (Path(__file__).resolve().parents[2] / uploads_dir).resolve()
    uploads_dir.mkdir(parents=True, exist_ok=True)
    return uploads_dir


def _storage_relative_path(attachment_id: UUID, filename: str) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix == '.kvaenc':
        suffix = '.bin'
    if len(suffix) > 16:
        suffix = suffix[:16]
    return Path("attachments") / attachment_id.hex[:2] / f"{attachment_id}{suffix}"


def resolve_attachment_path(relative_path: str) -> Path:
    root = _uploads_root().resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Attachment path is outside uploads directory")
    return path


def delete_stored_attachment(relative_path: str | None) -> None:
    if not relative_path:
        return

    file_path = resolve_attachment_path(relative_path)
    try:
        file_path.unlink(missing_ok=True)
        from app.services.attachment_previews import delete_preview
        delete_preview(file_path)
    except OSError:
        return

    parent = file_path.parent
    uploads_root = _uploads_root()
    while parent != uploads_root and parent.exists():
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def store_upload_file(
    upload: UploadFile,
    attachment_id: UUID,
    filename: str,
    *,
    max_size_bytes: int,
) -> StoredAttachment:
    """Copy a spooled upload in a worker thread, never directly on the event loop."""
    relative_path = _storage_relative_path(attachment_id, filename)
    if keyring() is not None:
        relative_path = encrypted_path(relative_path)
    final_path = resolve_attachment_path(relative_path.as_posix())
    try:
        size_bytes, checksum = write_file(upload.file, final_path, max_bytes=max_size_bytes)
    except FileTooLarge:
        raise AttachmentTooLargeError from None

    if Path(filename).suffix.lower() in {'.jpg','.jpeg','.png','.webp','.gif'}:
        from app.services.attachment_previews import ensure_preview
        ensure_preview(final_path)

    return StoredAttachment(
        filename=filename,
        mime_type=upload.content_type or "application/octet-stream",
        storage_path=relative_path.as_posix(),
        size_bytes=size_bytes,
        checksum_sha256=checksum,
    )
