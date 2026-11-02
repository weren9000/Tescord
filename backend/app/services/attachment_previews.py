"""Bounded, reusable previews. Original attachment bytes are never rewritten."""
import logging
import threading
import warnings
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from PIL import Image, ImageOps, UnidentifiedImageError
from app.services.encrypted_files import StoredReader, encrypted_path, is_encrypted, write_file

MAX_PREVIEW_PIXELS = 25_000_000
MAX_SOURCE_BYTES = 64 * 1024 * 1024
_slots = threading.BoundedSemaphore(1)
_locks = [threading.Lock() for _ in range(32)]


def preview_paths(source: Path):
    target = Path(str(source)+'.preview.webp')
    if is_encrypted(source):
        target = encrypted_path(target)
    return target, Path(str(source)+'.preview-unavailable')


def ensure_preview(source: Path) -> Path | None:
    target, unavailable = preview_paths(source)
    with _locks[hash(str(source)) % len(_locks)]:
        if not source.is_file():
            return None
        if target.is_file():
            return target
        if unavailable.is_file():
            return None
        temporary = target.with_name(target.name+'.'+uuid4().hex+'.part')
        try:
            with _slots, warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                if source.stat().st_size > MAX_SOURCE_BYTES:
                    unavailable.touch()
                    return None
                with StoredReader(source) as stream, Image.open(stream) as original:
                    if original.format not in {'JPEG','PNG','WEBP','GIF'} or original.width*original.height > MAX_PREVIEW_PIXELS:
                        unavailable.touch()
                        return None
                    original.seek(0)  # Animated sources use a static first frame in the timeline.
                    original.draft('RGB', (1280,1280))
                    image = ImageOps.exif_transpose(original)
                    image.thumbnail((640,640), Image.Resampling.LANCZOS)
                    image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
                    buffer = BytesIO()
                    image.save(buffer,format='WEBP',quality=78,method=3)
                    image.close()
                # A concurrent deletion must not recreate orphan previews.
                if not source.is_file():
                    return None
                buffer.seek(0)
                write_file(buffer, target, max_bytes=MAX_SOURCE_BYTES)
                return target
        except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, ValueError, EOFError):
            if source.is_file():unavailable.touch()
            return None
        except OSError:
            logging.getLogger(__name__).warning('Could not create attachment preview',exc_info=True)
            return None
        finally:
            temporary.unlink(missing_ok=True)


def delete_preview(source: Path):
    with _locks[hash(str(source)) % len(_locks)]:
        for path in preview_paths(source):
            path.unlink(missing_ok=True)
