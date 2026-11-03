"""Public release identifier, from the deployed source manifest (never runtime secrets)."""
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def release_revision() -> str | None:
    manifest = Path(__file__).resolve().parents[3] / 'SOURCE_REVISION'
    try:
        revision = manifest.read_text(encoding='ascii').strip()
    except (OSError, UnicodeError):
        return None
    return revision if re.fullmatch(r'[0-9a-f]{40}', revision) else None
