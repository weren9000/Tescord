from pathlib import Path
from sqlalchemy import text
from sqlalchemy.orm import Session

CATALOG = {'cyber-oni': {'name': 'Кибер-Они', 'kind': 'avatar'}}
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
