"""Bound decoded size and simultaneous work before handling untrusted pixels."""
from contextlib import contextmanager
from io import BytesIO
import threading
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

PROFILE_MAX_BYTES = 2 * 1024 * 1024
PROFILE_MAX_PIXELS = 4_000_000
PREVIEW_MAX_BYTES = 16 * 1024 * 1024
PREVIEW_MAX_PIXELS = 16_000_000
_slots = threading.BoundedSemaphore(1)


@contextmanager
def bounded_image(source, *, formats=('PNG', 'JPEG', 'WEBP', 'GIF'), max_pixels=PREVIEW_MAX_PIXELS):
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, 'Обработка изображений занята. Повторите попытку', headers={'Retry-After': '1'})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(source, formats=list(formats)) as original:
                if original.width * original.height > max_pixels or max(original.size) > 8192:
                    raise HTTPException(400, 'Слишком большое разрешение изображения')
                yield original
    except (UnidentifiedImageError, OSError, ValueError, EOFError,
            Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(400, 'Не удалось прочитать изображение') from error
    finally:
        _slots.release()


def normalize_profile_image(payload: bytes) -> tuple[bytes, str]:
    if not payload or len(payload) > PROFILE_MAX_BYTES:
        raise HTTPException(400, 'Изображение должно быть непустым и не больше 2 МБ')
    with bounded_image(BytesIO(payload), formats=('PNG', 'JPEG'), max_pixels=PROFILE_MAX_PIXELS) as original:
        if getattr(original, 'is_animated', False):
            raise HTTPException(400, 'Используйте статичное изображение')
        format_name = original.format
        original.thumbnail((512, 512), Image.Resampling.LANCZOS)
        with ImageOps.exif_transpose(original) as oriented:
            with oriented.convert('RGB' if format_name == 'JPEG' else 'RGBA') as image:
                image.info.clear()
                output = BytesIO()
                image.save(output, format_name, **({'quality': 88} if format_name == 'JPEG' else {}))
                return output.getvalue(), 'image/jpeg' if format_name == 'JPEG' else 'image/png'


def encode_preview(source, edge: int) -> bytes:
    with bounded_image(source) as original:
        original.seek(0)
        # Shrink before making the EXIF and color-conversion copies.
        original.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        with ImageOps.exif_transpose(original) as oriented:
            with oriented.convert('RGBA') as image:
                image.info.clear()
                output = BytesIO()
                image.save(output, 'WEBP', quality=76, method=4)
                return output.getvalue()
