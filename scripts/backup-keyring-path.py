"""Print only the root-relative archive member for the configured private keyring.

Used by the root backup helper. Never prints file contents or other env values.
"""
import os
from pathlib import Path
from dotenv import dotenv_values

try:
    config = dotenv_values('/srv/tescord/shared/backend.env')
    value = os.environ.get('TESCORD_DATA_KEYRING_PATH') or config.get('TESCORD_DATA_KEYRING_PATH')
    if not value:
        raise ValueError()
    original = Path(value)
    if not original.is_absolute():
        raise ValueError()
    keyring = original.resolve(strict=True)
    if not keyring.is_file() or keyring.stat().st_size > 65536 or '\n' in str(keyring):
        raise ValueError()
    print(keyring.relative_to('/').as_posix())
except Exception:
    raise SystemExit('Cannot include the private data keyring in the encrypted recovery archive') from None
