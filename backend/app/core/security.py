from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any


class TokenError(ValueError):
    """Raised when a bearer token cannot be parsed or verified."""


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def hash_password(password: str, *, iterations: int = 600_000) -> str:
    salt = os.urandom(16)
    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64url_encode(salt)}${_b64url_encode(derived_key)}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, expected_raw = password_hash.split("$", maxsplit=3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    salt = _b64url_decode(salt_raw)
    expected = _b64url_decode(expected_raw)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations_raw))
    return hmac.compare_digest(derived, expected)


def create_access_token(subject: str, secret_key: str, expires_in_minutes: int) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + expires_in_minutes * 60,
    }

    header_segment = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_segment = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_segment}.{payload_segment}.{_b64url_encode(signature)}"


def create_signed_token(payload: dict[str, Any], secret_key: str, expires_in_seconds: int) -> str:
    header = {"alg": "HS256", "typ": "SIGNED"}
    now = int(time.time())
    token_payload = {
        **payload,
        "iat": now,
        "exp": now + expires_in_seconds,
    }

    header_segment = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_segment = _b64url_encode(json.dumps(token_payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_segment}.{payload_segment}.{_b64url_encode(signature)}"


def decode_access_token(token: str, secret_key: str) -> dict[str, Any]:
    try:
        header_segment, payload_segment, signature_segment = token.split(".", maxsplit=2)
    except ValueError as exc:
        raise TokenError("Malformed access token") from exc

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()

    if not hmac.compare_digest(expected_signature, _b64url_decode(signature_segment)):
        raise TokenError("Invalid access token signature")

    payload = json.loads(_b64url_decode(payload_segment).decode("utf-8"))
    expires_at = payload.get("exp")

    if not isinstance(expires_at, int) or expires_at < int(time.time()):
        raise TokenError("Access token has expired")

    return payload


def decode_signed_token(token: str, secret_key: str) -> dict[str, Any]:
    try:
        header_segment, payload_segment, signature_segment = token.split(".", maxsplit=2)
    except ValueError as exc:
        raise TokenError("Malformed signed token") from exc

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()

    if not hmac.compare_digest(expected_signature, _b64url_decode(signature_segment)):
        raise TokenError("Invalid signed token signature")

    payload = json.loads(_b64url_decode(payload_segment).decode("utf-8"))
    expires_at = payload.get("exp")

    if not isinstance(expires_at, int) or expires_at < int(time.time()):
        raise TokenError("Signed token has expired")

    return payload
