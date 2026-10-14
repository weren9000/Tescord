import hashlib
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app.services import image_previews


def test_derivative_is_small_static_transparent_and_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(image_previews, '_uploads_root', lambda: tmp_path)
    source = tmp_path / 'animated.webp'
    frames = [Image.new('RGBA', (1024, 512), color) for color in [(255, 0, 0, 0), (0, 255, 0, 255)]]
    frames[0].putpixel((512, 256), (255, 0, 0, 255))
    frames[0].save(source, 'WEBP', save_all=True, append_images=frames[1:], lossless=True, duration=100)
    before = source.read_bytes()
    result = image_previews.preview_path(source)
    timestamp = result.stat().st_mtime_ns
    with Image.open(result) as preview:
        assert preview.size == (256, 128)
        assert getattr(preview, 'n_frames', 1) == 1
        assert preview.convert('RGBA').getpixel((0, 0))[3] == 0
    assert image_previews.preview_path(source).stat().st_mtime_ns == timestamp
    assert source.read_bytes() == before
    Image.new('RGB', (512, 512), 'blue').save(source, 'WEBP')
    assert image_previews.preview_path(source) != result


def test_preview_routes_and_conditional_requests(tmp_path, monkeypatch):
    monkeypatch.setattr(image_previews, '_uploads_root', lambda: tmp_path)
    with TestClient(app) as client:
        for url in ['/api/inventory/assets/wallpaper-golden-alchemy', '/api/wallpapers/presets/forest']:
            original = client.get(url)
            assert original.status_code == 200
            digest = hashlib.sha256(original.content).digest()
            preview = client.get(url + '?preview=true')
            assert preview.status_code == 200
            assert preview.headers['content-type'] == 'image/webp'
            assert len(preview.content) < len(original.content)
            with Image.open(BytesIO(preview.content)) as image:
                assert max(image.size) <= 256
            cached = client.get(url + '?preview=true', headers={'If-None-Match': preview.headers['etag']})
            assert cached.status_code == 304 and not cached.content
            assert hashlib.sha256(client.get(url).content).digest() == digest
        assert client.get('/api/inventory/assets/missing?preview=true').status_code == 404
        assert client.get('/api/wallpapers/presets/missing?preview=true').status_code == 404
        frame = client.get('/api/inventory/assets/frame-neon?preview=true')
        assert frame.status_code == 200 and b'<animate' not in frame.content
