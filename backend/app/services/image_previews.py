"""Small static derivatives; original files are never rewritten."""
import hashlib
import os
from pathlib import Path
import tempfile
from io import BytesIO

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, Response

from app.services.attachment_storage import _uploads_root
from app.services.safe_images import PREVIEW_MAX_BYTES, encode_preview


def _publish(directory: Path, target: Path, content: bytes):
    directory.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='preview-', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)


def small_preview_response(content: bytes, request: Request | None = None):
    """96 px thumbnails for database-backed avatars and space icons."""
    if len(content) > PREVIEW_MAX_BYTES:
        raise HTTPException(400, 'Изображение слишком большое для предпросмотра')
    key = hashlib.sha256(b'small-v2:96:' + content).hexdigest()
    etag = '"' + key + '"'
    headers = {'Cache-Control': 'public, max-age=300', 'ETag': etag, 'X-Content-Type-Options': 'nosniff'}
    if request and etag in [tag.strip().removeprefix('W/') for tag in request.headers.get('if-none-match', '').split(',')]:
        return Response(status_code=304, headers=headers)
    directory = _uploads_root() / 'previews'
    target = directory / (key + '.webp')
    if not target.is_file():
        _publish(directory, target, encode_preview(BytesIO(content), 96))
    return FileResponse(target, media_type='image/webp', headers=headers)


def preview_path(source: Path, edge: int = 256) -> Path:
    stat = source.stat()
    if stat.st_size > PREVIEW_MAX_BYTES:
        raise HTTPException(400, 'Изображение слишком большое для предпросмотра')
    key = hashlib.sha256(f'v3:{edge}:{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    directory = _uploads_root() / 'previews'
    target = directory / (key + '.webp')
    if target.is_file():
        return target
    _publish(directory, target, encode_preview(source, edge))
    return target


def preview_response(source: Path, request: Request, edge: int = 256):
    path = preview_path(source, edge)
    etag = '"' + path.stem + '"'
    headers = {'Cache-Control': 'public, max-age=3600', 'ETag': etag, 'X-Content-Type-Options': 'nosniff'}
    if etag in [tag.strip().removeprefix('W/') for tag in request.headers.get('if-none-match', '').split(',')]:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type='image/webp', headers=headers)
