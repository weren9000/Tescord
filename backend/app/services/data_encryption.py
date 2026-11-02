"""Server-side encryption. Keys never come from the database or login passwords.

The keyring lives outside releases and ordinary data dumps. Its recovery copy
belongs in a separately encrypted configuration archive. Retain old keys until all rows,
files and retained backups using them have been migrated and verified.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from app.core.config import get_settings


class EncryptionUnavailable(RuntimeError):
    def __init__(self):
        super().__init__('Encrypted data is unavailable; check the encryption keyring and data integrity')


_known_key_hashes: dict[str, dict[str, bytes]] = {}


@dataclass(frozen=True, repr=False)
class Keyring:
    active: str
    keys: dict[str, bytes]

    def key(self, key_id: str) -> bytes:
        try:
            return self.keys[key_id]
        except KeyError:
            raise EncryptionUnavailable() from None


@lru_cache(maxsize=4)
def _read_keyring(path: str, modified: int, size: int) -> Keyring:
    try:
        raw = json.loads(Path(path).read_text(encoding='utf-8'))
        keys = {UUID(k).hex: base64.b64decode(v, validate=True) for k, v in raw['keys'].items()}
        active = UUID(raw['active']).hex
        if not keys or len(keys) > 32 or active not in keys or any(len(v) != 32 for v in keys.values()):
            raise ValueError()
        known = _known_key_hashes.setdefault(path, {})
        for key_id, key in keys.items():
            digest = hashlib.sha256(key).digest()
            if key_id in known and known[key_id] != digest:
                raise ValueError()
        known.update({key_id:hashlib.sha256(key).digest() for key_id, key in keys.items()})
        return Keyring(active, keys)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise EncryptionUnavailable() from None


def keyring() -> Keyring | None:
    settings = get_settings()
    path = settings.data_keyring_path
    if not path:
        if settings.data_encryption_required:
            raise EncryptionUnavailable()
        return None
    try:
        info = Path(path).stat()
    except OSError:
        raise EncryptionUnavailable() from None
    return _read_keyring(str(Path(path).resolve()), info.st_mtime_ns, info.st_size)


def required_keyring() -> Keyring:
    result = keyring()
    if result is None:
        raise EncryptionUnavailable()
    return result


def derive_key(key: bytes, salt: bytes, purpose: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=purpose).derive(key)


def seal(data: bytes, context: str) -> bytes:
    ring = required_keyring()
    # Fresh subkey per envelope, including repeated edits of the same row.
    header = b'KVT1' + bytes.fromhex(ring.active) + os.urandom(32)
    key = derive_key(ring.key(ring.active), header[20:], b'kvachat/text/v1')
    return header + AESGCM(key).encrypt(bytes(12), data, header + context.encode())


def unseal(data: bytes, context: str) -> bytes:
    try:
        if len(data) < 68 or data[:4] != b'KVT1':
            raise ValueError()
        ring = required_keyring()
        header = data[:52]
        key = derive_key(ring.key(header[4:20].hex()), header[20:], b'kvachat/text/v1')
        return AESGCM(key).decrypt(bytes(12), data[52:], header + context.encode())
    except (InvalidTag, ValueError, TypeError):
        raise EncryptionUnavailable() from None


def _grams(value: str, length: int) -> set[str]:
    return {value[i:i+length] for i in range(len(value)-length+1)}


def _tokens(values: set[str], key_id: str, key: bytes) -> list[str]:
    index_key = derive_key(key, b'kvachat/search', b'kvachat/search/v1')
    return [key_id + hmac.new(index_key, value.encode(), hashlib.sha256).hexdigest()[:32]
            for value in sorted(values)]


def index_tokens(value: str) -> list[str]:
    ring = required_keyring()
    normalized = value.casefold()
    grams = set().union(*(_grams(normalized, n) for n in (1, 2, 3)))
    return _tokens(grams, ring.active, ring.key(ring.active))


def query_tokens(terms: list[str]) -> list[list[str]]:
    ring = keyring()
    if ring is None:
        return []
    grams = set().union(*(_grams(term.casefold(), min(3, len(term.casefold()))) for term in terms))
    return [_tokens(grams, key_id, key) for key_id, key in ring.keys.items()]


class EncryptedContent:
    """ORM mixin: separate columns distinguish legacy plaintext unambiguously."""
    @property
    def content(self) -> str:
        if self.encrypted_content is None:
            return self.legacy_content or ''
        return unseal(self.encrypted_content, f'{self.__tablename__}/{self.id}/content').decode('utf-8')

    @content.setter
    def content(self, value: str):
        self.legacy_content = value
        self.encrypted_content = None


def encrypt_content_before_write(mapper, connection, target):
    if target.encrypted_content is not None or keyring() is None:
        return
    from uuid import uuid4
    if target.id is None:
        target.id = uuid4()
    content = target.legacy_content or ''
    target.encrypted_content = seal(content.encode(), f'{target.__tablename__}/{target.id}/content')
    if hasattr(target, 'search_tokens'):
        target.search_tokens = index_tokens(content)
    target.legacy_content = ''


def check_database_keys(db):
    """Detect configuration loss or a replaced key before any new write is served."""
    from sqlalchemy import select
    from app.db.models import EncryptionKeyCheck
    ring = keyring()
    for check in db.scalars(select(EncryptionKeyCheck)):
        if unseal(check.ciphertext, 'key-check/'+check.key_id) != b'kvachat-key-check-v1':
            raise EncryptionUnavailable()
    if ring and db.get(EncryptionKeyCheck, ring.active) is None:
        db.add(EncryptionKeyCheck(key_id=ring.active,
                                  ciphertext=seal(b'kvachat-key-check-v1', 'key-check/'+ring.active)))
