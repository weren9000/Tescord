"""Run from backend with its environment: python ../scripts/warm-image-previews.py."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.services.image_previews import preview_path
from app.services.inventory import ASSETS, asset_path
from app.services.attachment_storage import _uploads_root

sources = list(ASSETS.glob('*.png')) + list(ASSETS.glob('*.webp'))
sources += list((ASSETS.parent / 'wallpapers').glob('*.webp'))
sources += list((_uploads_root() / 'collectibles').glob('*.webp'))
original = previews = 0
for source in sources:
    target = preview_path(source)
    original += source.stat().st_size
    previews += target.stat().st_size
print(f'Prepared {len(sources)} previews; original bytes: {original}; preview bytes: {previews}')
