"""Sign 60-second, single-use grants for the independent Islands service."""
import base64
import json
from pathlib import Path
import time
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def create_islands_grant(user_id: str, nick: str, key_path: str):
    key = serialization.load_pem_private_key(Path(key_path).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError('Islands requires a separate Ed25519 signing key')
    now = int(time.time())
    claims = {'iss': 'kvachat', 'aud': 'islands', 'sub': user_id, 'nick': nick[:80],
              'iat': now, 'exp': now + 60, 'jti': str(uuid4())}
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')
    payload = encode(json.dumps(claims, separators=(',', ':'), ensure_ascii=False).encode())
    return {'grant': payload + '.' + encode(key.sign(payload.encode('ascii'))), 'expires_at': claims['exp']}
