from pathlib import Path
from sqlalchemy import text
from sqlalchemy.orm import Session

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


def lock_inventory(db: Session) -> None:
    # Serialize ownership/equipment operations, including ordinary profile changes.
    # Transaction-scoped PostgreSQL lock is released on commit or rollback.
    db.execute(text('SELECT pg_advisory_xact_lock(742190026)'))
