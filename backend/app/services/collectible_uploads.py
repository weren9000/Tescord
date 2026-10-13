from io import BytesIO
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException


def prepare_image(payload: bytes, kind: str, x: float, y: float, zoom: float) -> bytes:
    if len(payload) > 10*1024*1024:
        raise HTTPException(413, 'Изображение должно быть не больше 10 МБ')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as original:
                if original.format not in ('PNG', 'JPEG', 'WEBP') or getattr(original, 'is_animated', False):
                    raise HTTPException(400, 'Используйте статичное изображение PNG, JPG или WebP')
                if min(original.size) < 128 or max(original.size) > 4096:
                    raise HTTPException(400, 'Размер изображения: от 128 до 4096 пикселей по каждой стороне')
                original.load()
                picture = ImageOps.exif_transpose(original).convert('RGBA')
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, 'Не удалось прочитать изображение')
    w, h = picture.size
    if kind == 'frame':
        if w != h: raise HTTPException(400, 'Рамка должна быть квадратной')
        alpha = picture.getchannel('A')
        center = alpha.crop((int(w*.3), int(h*.3), int(w*.7), int(h*.7)))
        if center.getextrema()[1] > 20:
            raise HTTPException(400, 'Центр рамки должен быть прозрачным')
        if alpha.getextrema()[1] == 0: raise HTTPException(400, 'Рамка полностью прозрачна')
    else:
        side = min(w, h) / zoom
        left, top = (w-side)*x, (h-side)*y
        picture = picture.crop((round(left), round(top), round(left+side), round(top+side)))
    picture = picture.resize((512,512), Image.Resampling.LANCZOS)
    output = BytesIO()
    picture.save(output, format='WEBP', quality=92, method=4)
    return output.getvalue()
