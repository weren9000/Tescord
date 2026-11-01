"""Coturn REST credentials, issued only after the enclosing media admission check."""
import base64
import hashlib
import hmac
import time

from app.core.config import get_settings


def turn_ice_servers(subject: str) -> list[dict[str, object]]:
    settings = get_settings()
    if not settings.turn_urls or not settings.turn_shared_secret:
        # LiveKit may supply its own ICE servers. Never fall back to public static credentials.
        return []
    secret = settings.turn_shared_secret.get_secret_value().encode()
    expires = int(time.time()) + settings.turn_credential_ttl_seconds
    identity = hmac.new(secret, subject.encode(), hashlib.sha256).hexdigest()[:32]
    username = f'{expires}:{identity}'
    password = base64.b64encode(hmac.new(secret, username.encode(), hashlib.sha1).digest()).decode()
    return [{'urls': list(settings.turn_urls), 'username': username, 'credential': password}]
