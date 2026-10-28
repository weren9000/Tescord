"""Shared, expiring Redis limits. Keys contain hashes, never credentials or email."""
import asyncio
import hashlib
from functools import lru_cache

from fastapi import HTTPException
from starlette.responses import JSONResponse

from app.core.config import get_settings
from app.core.security import TokenError, decode_access_token, decode_signed_token

SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
"""


@lru_cache
def _redis():
    from redis import Redis
    return Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)


def enforce_limit(scope: str, identity: str, limit: int, seconds: int) -> None:
    if not get_settings().rate_limits_enabled:
        return
    digest = hashlib.sha256(identity.encode()).hexdigest()
    try:
        count, ttl = _redis().eval(SCRIPT, 1, f'kva:limit:{scope}:{digest}', seconds)
    except Exception as exc:
        raise HTTPException(503, 'Request protection temporarily unavailable', headers={'Retry-After': '5'}) from exc
    if count > limit:
        raise HTTPException(429, 'Too many requests', headers={'Retry-After': str(max(1, ttl))})


class RateLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] not in {'http', 'websocket'} or not get_settings().rate_limits_enabled:
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        ip = (scope.get('client') or ('unknown', 0))[0]
        room_identity = None
        if path.startswith('/api/rooms/'):
            authorization = dict(scope.get('headers', [])).get(b'authorization', b'').decode('latin-1')
            if authorization.startswith('Bearer '):
                try:
                    claims = decode_signed_token(authorization[7:], get_settings().secret_key)
                    if claims.get('purpose') == 'meeting':
                        room_identity = 'meeting:' + claims['pid']
                except (TokenError, KeyError, TypeError):
                    pass
        try:
            if scope['type'] == 'websocket':
                await asyncio.to_thread(enforce_limit, 'ws', ip, 120, 60)
            elif path.startswith('/api/') and path != '/api/health':
                await asyncio.to_thread(enforce_limit, 'http', room_identity or ip, 1200, 60)
                if path in {'/api/auth/login', '/api/auth/register'}:
                    limit = 60 if path.endswith('login') else 10
                    await asyncio.to_thread(enforce_limit, path.rsplit('/', 1)[-1], ip, limit, 300)
                elif scope.get('method') in {'POST', 'PUT', 'DELETE', 'PATCH'}:
                    authorization = dict(scope.get('headers', [])).get(b'authorization', b'').decode('latin-1')
                    if authorization.startswith('Bearer '):
                        try:
                            identity = decode_access_token(authorization[7:], get_settings().secret_key)['sub']
                        except (TokenError, KeyError):
                            identity = room_identity or ip
                        await asyncio.to_thread(enforce_limit, 'write', identity, 180, 60)
        except HTTPException as exc:
            if scope['type'] == 'websocket':
                await send({'type': 'websocket.close', 'code': 1013})
            else:
                await JSONResponse({'detail': exc.detail}, status_code=exc.status_code, headers=exc.headers)(scope, receive, send)
            return
        await self.app(scope, receive, send)
