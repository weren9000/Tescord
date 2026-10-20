"""Small static derivatives; original files are never rewritten."""
import hashlib
import os
from pathlib import Path
import tempfile
from io import BytesIO

from fastapi import Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps

from app.services.attachment_storage import _uploads_root


def small_preview_response(content: bytes, request: Request | None = None):
    """96 px thumbnails for database-backed avatars and space icons."""
    key = hashlib.sha256(b'small-v1:96:' + content).hexdigest()
    etag = '"' + key + '"'
    headers = {'Cache-Control': 'public, max-age=300', 'ETag': etag, 'X-Content-Type-Options': 'nosniff'}
    if request and etag in [tag.strip().removeprefix('W/') for tag in request.headers.get('if-none-match', '').split(',')]:
        return Response(status_code=304, headers=headers)
    directory = _uploads_root() / 'previews'
    target = directory / (key + '.webp')
    if not target.is_file():
        directory.mkdir(parents=True, exist_ok=True)
        with Image.open(BytesIO(content)) as original:
            original.seek(0)
            image = ImageOps.exif_transpose(original).convert('RGBA')
            image.thumbnail((96, 96), Image.Resampling.LANCZOS)
            fd, name = tempfile.mkstemp(prefix='small-', suffix='.tmp', dir=directory)
            try:
                with os.fdopen(fd, 'wb') as output:
                    image.save(output, 'WEBP', quality=76, method=4)
                os.replace(name, target)
            finally:
                Path(name).unlink(missing_ok=True)
    return FileResponse(target, media_type='image/webp', headers=headers)


def preview_path(source: Path) -> Path:
    stat = source.stat()
    key = hashlib.sha256(f'v1:256:{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    directory = _uploads_root() / 'previews'
    target = directory / (key + '.webp')
    if target.is_file():
        return target
    directory.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        original.seek(0)
        image = ImageOps.exif_transpose(original).convert('RGBA')
        image.thumbnail((256, 256), Image.Resampling.LANCZOS)
        # Encode before publishing so concurrent readers never see a partial image.
        fd, name = tempfile.mkstemp(prefix='preview-', suffix='.tmp', dir=directory)
        try:
            with os.fdopen(fd, 'wb') as output:
                image.save(output, 'WEBP', quality=76, method=4)
            os.replace(name, target)
        finally:
            Path(name).unlink(missing_ok=True)
    return target


def preview_response(source: Path, request: Request):
    path = preview_path(source)
    etag = '"' + path.stem + '"'
    headers = {'Cache-Control': 'public, max-age=3600', 'ETag': etag, 'X-Content-Type-Options': 'nosniff'}
    if etag in [tag.strip().removeprefix('W/') for tag in request.headers.get('if-none-match', '').split(',')]:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type='image/webp', headers=headers)
