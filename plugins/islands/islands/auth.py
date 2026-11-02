"""Verify a narrowly scoped, single-use Kvachat grant using a public key only.

Wire format: base64url(JSON claims) + '.' + base64url(Ed25519 signature).
No configurable algorithm, remote key lookup, or main-chat access token.
"""
from __future__ import annotations

import base64
import binascii
import json
import re
import time
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .engine import RuleError


def verify_grant(token: str, key: Ed25519PublicKey, now=None):
    now = int(time.time() if now is None else now)
    try:
        if not isinstance(token, str) or not 80 <= len(token) <= 2048:
            raise ValueError()
        payload, signature = token.split('.')
        if not all(re.fullmatch(r'[A-Za-z0-9_-]+', part) for part in (payload, signature)):
            raise ValueError()
        decode = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
        key.verify(decode(signature), payload.encode('ascii'))
        claims = json.loads(decode(payload))
        if set(claims) != {'iss', 'aud', 'sub', 'nick', 'iat', 'exp', 'jti'}:
            raise ValueError()
        if claims['iss'] != 'kvachat' or claims['aud'] != 'islands':
            raise ValueError()
        if type(claims['iat']) is not int or type(claims['exp']) is not int:
            raise ValueError()
        if not now - 60 <= claims['iat'] <= now + 5 or not now < claims['exp'] <= claims['iat'] + 60:
            raise ValueError()
        for field in ('sub', 'jti'):
            if not isinstance(claims[field], str) or str(UUID(claims[field])) != claims[field]:
                raise ValueError()
        if not isinstance(claims['nick'], str) or not 1 <= len(claims['nick']) <= 80:
            raise ValueError()
        return claims
    except (ValueError, TypeError, KeyError, AttributeError, binascii.Error, InvalidSignature):
        raise RuleError('Войдите в игру через Квачат.', 'unauthorized') from None
