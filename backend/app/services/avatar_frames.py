"""Compose trusted frame assets over avatars without changing the original image."""
from base64 import b64encode
from functools import lru_cache
from app.services.inventory import ASSETS, CATALOG

SVG_START = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
NEON = '''<defs><linearGradient id="neon" x1="0" y1="0" x2="1" y2="1">
<stop stop-color="#31d7eb"/><stop offset=".4" stop-color="#754bff"/>
<stop offset=".75" stop-color="#ef68d4"/><stop offset="1" stop-color="#31d7eb"/>
</linearGradient></defs><style>
@keyframes flow{0%{filter:hue-rotate(0deg)}50%{filter:hue-rotate(80deg)}100%{filter:hue-rotate(0deg)}}
.neon{animation:flow 7s linear infinite}
@media(prefers-reduced-motion:reduce){.neon{animation:none}}
</style><rect class="neon" x="43" y="43" width="426" height="426" rx="94"
fill="none" stroke="url(#neon)" stroke-width="15"/>'''


def data_uri(content: bytes, mime: str) -> str:
    # MIME types are chosen from a fixed allowlist; uploaded bytes are never XML.
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        raise ValueError('Unsupported avatar format')
    return f'data:{mime};base64,{b64encode(content).decode("ascii")}'


@lru_cache(maxsize=10)
def frame_layer(catalog_id: str) -> str:
    if CATALOG.get(catalog_id, {}).get('kind') != 'frame':
        raise ValueError('Unknown frame')
    if catalog_id == 'frame-neon':
        return NEON
    uri = data_uri((ASSETS / f'{catalog_id}.webp').read_bytes(), 'image/webp')
    return f'<image width="512" height="512" href="{uri}"/>'


def frame_svg(catalog_id: str, avatar: bytes | None = None, mime: str = 'image/webp', motion: bool = True) -> str:
    inner = ''
    if avatar is not None:
        uri = data_uri(avatar, mime)
        inner = ('<defs><clipPath id="avatar"><rect x="43" y="43" width="426" height="426" rx="82"/></clipPath></defs>'
                 f'<image x="43" y="43" width="426" height="426" preserveAspectRatio="xMidYMid slice" '
                 f'clip-path="url(#avatar)" href="{uri}"/>')
    layer = frame_layer(catalog_id)
    if not motion:
        layer = layer.replace('animation:flow 7s linear infinite', 'animation:none')
    return SVG_START + inner + layer + '</svg>'
