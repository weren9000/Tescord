from pathlib import Path
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.services.collectible_wallpapers import WALLPAPERS

CATALOG = {'cyber-oni': {'name': 'Кибер-Они', 'kind': 'avatar'}}
COLLECTIBLE_AVATARS = {
    'shark': 'Акула', 'chameleon': 'Хамелеон', 'alpaca': 'Альпака',
    'crocodile': 'Крокодил', 'toucan': 'Тукан', 'horse': 'Лошадка',
    'axolotl': 'Аксолотль', 'octopus': 'Осьминог',
    'unicorn': 'Единорог', 'dragon': 'Дракон',
}
CATALOG.update({key: {'name': name, 'kind': 'avatar'} for key, name in COLLECTIBLE_AVATARS.items()})
FRAME_NAMES = {
    'neon': 'Неоновый поток', 'cyber-oni': 'Кибер-Они',
    'aurora': 'Северное сияние', 'obsidian': 'Обсидиан',
    'ice': 'Ледяная грань', 'solar-gold': 'Солнечное золото',
    'sakura': 'Сакура', 'orbit': 'Орбита',
    'emerald': 'Изумруд', 'kva': 'Ква-рамка',
}
CATALOG.update({f'frame-{key}': {'name': name, 'kind': 'frame'} for key, name in FRAME_NAMES.items()})
ASSETS = Path(__file__).resolve().parents[1] / 'assets' / 'collectibles'
CATALOG.update({key: {'name': name, 'kind': 'wallpaper'} for key, name in WALLPAPERS.items()})


def catalog_data(db, catalog_id):
    from app.db.inventory import InventoryCatalog
    entry = db.get(InventoryCatalog, catalog_id)
    return {'name': entry.name, 'kind': entry.kind, 'rarity': entry.rarity} if entry else {'name': catalog_id, 'kind': 'avatar'}


def asset_path(catalog_id):
    from app.services.attachment_storage import _uploads_root
    from uuid import UUID
    if catalog_id in WALLPAPERS:
        return ASSETS / (catalog_id + '.png')
    if catalog_id in CATALOG:
        return ASSETS / (catalog_id + '.webp')
    # All custom asset identifiers are server-generated UUIDs.
    UUID(catalog_id)
    return _uploads_root() / 'collectibles' / (catalog_id + '.webp')


def lock_inventory(db: Session) -> None:
    # Serialize ownership/equipment operations, including ordinary profile changes.
    # Transaction-scoped PostgreSQL lock is released on commit or rollback.
    db.execute(text('SELECT pg_advisory_xact_lock(742190026)'))
