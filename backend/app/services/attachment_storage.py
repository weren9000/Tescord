from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile

from app.core.config import get_settings

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
    if len(suffix) > 16:
        suffix = suffix[:16]
    return Path("attachments") / attachment_id.hex[:2] / f"{attachment_id}{suffix}"


def resolve_attachment_path(relative_path: str) -> Path:
    return (_uploads_root() / relative_path).resolve()


def delete_stored_attachment(relative_path: str | None) -> None:
    if not relative_path:
        return

    file_path = resolve_attachment_path(relative_path)
    try:
        file_path.unlink(missing_ok=True)
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


async def store_upload_file(
    upload: UploadFile,
    attachment_id: UUID,
    filename: str,
    *,
    max_size_bytes: int,
) -> StoredAttachment:
    relative_path = _storage_relative_path(attachment_id, filename)
    final_path = resolve_attachment_path(relative_path.as_posix())
    temp_path = final_path.with_suffix(f"{final_path.suffix}.part")
    final_path.parent.mkdir(parents=True, exist_ok=True)

    file_hash = sha256()
    size_bytes = 0

    try:
        with temp_path.open("wb") as target_file:
            while True:
                chunk = await upload.read(CHUNK_SIZE_BYTES)
                if not chunk:
                    break

                size_bytes += len(chunk)
                if size_bytes > max_size_bytes:
                    raise AttachmentTooLargeError

                file_hash.update(chunk)
                target_file.write(chunk)

        temp_path.replace(final_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    return StoredAttachment(
        filename=filename,
        mime_type=upload.content_type or "application/octet-stream",
        storage_path=relative_path.as_posix(),
        size_bytes=size_bytes,
        checksum_sha256=file_hash.hexdigest(),
    )
