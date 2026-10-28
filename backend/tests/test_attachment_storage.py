from hashlib import sha256
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import UploadFile

from app.services import attachment_storage as storage


def test_upload_is_atomic_and_preserves_checksum(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(uploads_dir=str(tmp_path)))
    content = b"attachment" * 200_000
    upload = UploadFile(filename="report.txt", file=BytesIO(content))
    stored = storage.store_upload_file(upload, uuid4(), "report.txt", max_size_bytes=len(content))
    assert storage.resolve_attachment_path(stored.storage_path).read_bytes() == content
    assert stored.size_bytes == len(content)
    assert stored.checksum_sha256 == sha256(content).hexdigest()
    assert not list(tmp_path.rglob("*.part"))


def test_oversized_upload_leaves_no_partial_file(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(uploads_dir=str(tmp_path)))
    upload = UploadFile(filename="large.bin", file=BytesIO(b"x" * (storage.CHUNK_SIZE_BYTES + 1)))
    with pytest.raises(storage.AttachmentTooLargeError):
        storage.store_upload_file(upload, uuid4(), "large.bin", max_size_bytes=storage.CHUNK_SIZE_BYTES)
    assert not [path for path in tmp_path.rglob("*") if path.is_file()]


def test_failed_read_leaves_no_partial_file(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(uploads_dir=str(tmp_path)))

    class BrokenFile(BytesIO):
        def read(self, size=-1):
            raise OSError("Disk unavailable")

    with pytest.raises(OSError):
        storage.store_upload_file(UploadFile(file=BrokenFile()), uuid4(), "file.bin", max_size_bytes=100)
    assert not [path for path in tmp_path.rglob("*") if path.is_file()]
