from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import json
import os
from pathlib import Path
import time
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette._utils import get_route_path

from .auth import verify_grant
from .engine import RuleError, amounts, require
from .store import Store


@dataclass(frozen=True)
class Config:
    database: str
    public_key: Ed25519PublicKey
    origins: tuple[str, ...]
    hosts: tuple[str, ...] = ('127.0.0.1', 'localhost', 'testserver')

    @classmethod
    def from_env(cls):
        key_path = os.environ['ISLANDS_GRANT_PUBLIC_KEY_PATH']
        key = serialization.load_pem_public_key(Path(key_path).read_bytes())
        if not isinstance(key, Ed25519PublicKey):
            raise ValueError('Islands requires an Ed25519 public key')
        origins = tuple(s.strip() for s in os.environ['ISLANDS_ALLOWED_ORIGINS'].split(',') if s.strip())
        if not origins or any(s == '*' or not s.startswith(('https://', 'http://localhost:', 'http://127.0.0.1:')) for s in origins):
            raise ValueError('Set explicit HTTPS or local development origins')
        return cls(os.environ.get('ISLANDS_DATABASE', './storage/islands.sqlite3'), key, origins,
                   tuple(s.strip() for s in os.environ.get('ISLANDS_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')))


class Payload(BaseModel):
    model_config = ConfigDict(extra='forbid')


class GrantBody(Payload):
    grant: StrictStr = Field(min_length=80, max_length=2048)


class CreateBody(Payload):
    request_id: UUID


class JoinBody(Payload):
    code: StrictStr = Field(pattern=r'^[0-9A-F]{12}$')


FIELDS = {
    'ready': ({'ready': bool}, {}), 'color': ({'color': str}, {}),
    'start': ({}, {}), 'leave': ({}, {}), 'pause': ({}, {}), 'resume': ({}, {}),
    'abandon_vote': ({'vote': bool}, {}),
    'setup_settlement': ({'vertex': str}, {}), 'setup_road': ({'edge': str}, {}),
    'roll': ({}, {}), 'discard': ({'resources': dict}, {}),
    'move_robber': ({'tile': str}, {}), 'steal': ({'victim': str}, {}),
    'build': ({'kind': str, 'target': str}, {}),
    'bank_trade': ({'give': dict, 'want': dict}, {}),
    'trade_offer': ({'give': dict, 'want': dict}, {'target': (str, type(None))}),
    'trade_accept': ({'offer': str}, {}), 'trade_decline': ({'offer': str}, {}), 'trade_cancel': ({'offer': str}, {}),
    'buy_development': ({}, {}),
    'play_development': ({'card': str}, {'resources': dict, 'resource': str}),
    'end_turn': ({}, {}),
}


class CommandBody(Payload):
    request_id: UUID
    version: StrictInt = Field(ge=0, le=2147483647)
    command: dict

    @field_validator('command')
    @classmethod
    def valid_command(cls, command):
        action = command.get('type')
        if not isinstance(action, str) or action not in FIELDS:
            raise ValueError('Unknown command')
        required, optional = FIELDS[action]
        if not set(required) <= set(command) or not set(command) <= {'type', *required, *optional}:
            raise ValueError('Invalid command fields')
        for key, expected in {**required, **optional}.items():
            if key not in command:
                continue
            value = command[key]
            if type(value) not in (expected if isinstance(expected, tuple) else (expected,)):
                raise ValueError('Invalid command field type')
            if isinstance(value, str) and not 1 <= len(value) <= 80:
                raise ValueError('Invalid field length')
            if isinstance(value, dict):
                try:
                    amounts(value)
                except RuleError:
                    raise ValueError('Invalid resource amounts') from None
        return command


class Limiter:
    def __init__(self):
        self.windows = OrderedDict()

    def allow(self, key, count=180):
        now = time.monotonic()
        started, used = self.windows.pop(key, (now, 0))
        if now - started >= 60:
            started, used = now, 0
        self.windows[key] = (started, used + 1)
        while len(self.windows) > 10000:
            self.windows.popitem(last=False)
        return used < count


class BodyLimit:
    """Bound actual streamed bytes, even if Content-Length is absent or false."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in ('POST', 'PUT', 'PATCH'):
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            try:
                event = await asyncio.wait_for(receive(), 10)
            except TimeoutError:
                return await JSONResponse({'detail': 'Время загрузки запроса истекло.'}, status_code=408)(scope, receive, send)
            if event['type'] == 'http.disconnect':
                return
            body.extend(event.get('body', b''))
            if len(body) > 8192:
                return await JSONResponse({'detail': 'Слишком большой запрос.'}, status_code=413)(scope, receive, send)
            if not event.get('more_body'):
                break
        consumed = False
        async def bounded_receive():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, bounded_receive, send)


def create_app(config: Config | None = None):
    config = config or Config.from_env()
    app = FastAPI(title='Islands', docs_url=None, redoc_url=None, openapi_url=None)
    store = Store(config.database)
    app.state.store = store
    limiter = Limiter()
    connections = {}
    app.add_middleware(BodyLimit)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(config.hosts))
    app.add_middleware(CORSMiddleware, allow_origins=list(config.origins),
                       allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])

    @app.middleware('http')
    async def headers_and_limits(request: Request, call_next):
        origin = request.headers.get('origin')
        if origin and origin not in config.origins:
            return JSONResponse({'detail': 'Источник запроса не разрешён.'}, status_code=403)
        key = ('ip', request.client.host if request.client else 'unknown')
        route_path = get_route_path(request.scope)
        if route_path.startswith('/api/') and not limiter.allow(key, 1200):
            return JSONResponse({'detail': 'Слишком много запросов.'}, status_code=429)
        response = await call_next(request)
        response.headers['Cache-Control'] = ('no-store' if route_path.startswith('/api/')
                                            else 'public, max-age=3600' if route_path.startswith('/assets/') and response.status_code == 200
                                            else 'no-cache')
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors " + ' '.join(config.origins)
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        return response

    @app.exception_handler(RuleError)
    async def rule_error(request, exc):
        status = {'unauthorized': 401, 'not_found': 404, 'not_member': 404, 'conflict': 409, 'limit': 429}.get(exc.code, 400)
        return JSONResponse({'detail': str(exc), 'code': exc.code}, status_code=status)

    async def user(request: Request):
        header = request.headers.get('authorization', '')
        require(header.startswith('Bearer '), 'Откройте игру через Квачат.', 'unauthorized')
        result = await run_in_threadpool(store.authenticate, header[7:])
        require(limiter.allow(('user', result['uid']), 240), 'Слишком много действий.', 'limit')
        return result

    @app.get('/health')
    def health():
        return {'ok': True, 'service': 'islands'}

    @app.get('/api/config')
    def public_config():
        return {'parent_origins': config.origins}

    @app.post('/api/auth')
    def auth(body: GrantBody):
        claims = verify_grant(body.grant, config.public_key, store.clock())
        return store.exchange(claims)

    @app.delete('/api/auth')
    def logout(request: Request, current=Depends(user)):
        store.revoke(request.headers['authorization'][7:])
        return {'ok': True}

    @app.get('/api/rooms')
    def rooms(current=Depends(user)):
        return store.list_rooms(current['uid'])

    @app.post('/api/rooms')
    def create(body: CreateBody, current=Depends(user)):
        return store.create(current, str(body.request_id))

    @app.post('/api/rooms/join')
    def join(body: JoinBody, current=Depends(user)):
        return store.join(body.code, current)

    @app.get('/api/rooms/{room_id}')
    def room(room_id: UUID, current=Depends(user)):
        return store.get(str(room_id), current['uid'])

    @app.post('/api/rooms/{room_id}/commands')
    def command(room_id: UUID, body: CommandBody, current=Depends(user)):
        return store.command(str(room_id), current, str(body.request_id), body.version, body.command)

    @app.websocket('/api/rooms/{room_id}/stream')
    async def stream(websocket: WebSocket, room_id: UUID):
        if websocket.headers.get('origin') not in config.origins:
            return await websocket.close(code=4403)
        if not limiter.allow(('ws', websocket.client.host if websocket.client else 'unknown'), 120):
            return await websocket.close(code=4429)
        await websocket.accept()
        uid = None
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), 5)
            require(len(raw.encode()) <= 1024, 'Invalid frame', 'unauthorized')
            auth_frame = json.loads(raw)
            require(isinstance(auth_frame, dict) and set(auth_frame) == {'type', 'token'} and auth_frame['type'] == 'authenticate', 'Missing authentication', 'unauthorized')
            token = auth_frame['token']
            current = await run_in_threadpool(store.authenticate, token)
            require(connections.get(current['uid'], 0) < 4, 'Too many connections', 'limit')
            uid = current['uid']
            connections[uid] = connections.get(uid, 0) + 1
            last_version = None
            last_heartbeat = time.monotonic()
            # Each socket reads a per-player projection. Durable versions also
            # work after process restart; no broadcast of internal state exists.
            while True:
                await run_in_threadpool(store.authenticate, token)
                view = await run_in_threadpool(store.get, str(room_id), uid)
                if view['version'] != last_version:
                    await websocket.send_json({'type': 'state', 'room': view})
                    last_version = view['version']
                if time.monotonic() - last_heartbeat >= 20:
                    await websocket.send_json({'type': 'heartbeat'})
                    last_heartbeat = time.monotonic()
                try:
                    raw = await asyncio.wait_for(websocket.receive_text(), 0.6)
                except TimeoutError:
                    continue
                require(len(raw.encode()) <= 1024 and limiter.allow(('frame', uid), 120), 'Frame limit', 'limit')
                frame = json.loads(raw)
                require(isinstance(frame, dict), 'Invalid frame')
                if frame.get('type') == 'authenticate' and set(frame) == {'type', 'token'}:
                    renewed = await run_in_threadpool(store.authenticate, frame['token'])
                    require(renewed['uid'] == uid, 'Account changed', 'unauthorized')
                    token = frame['token']
                elif frame == {'type': 'ping'}:
                    await websocket.send_json({'type': 'pong'})
                else:
                    raise RuleError('Invalid frame')
        except RuleError as exc:
            await websocket.close(code={'unauthorized': 4401, 'not_found': 4404, 'limit': 4429}.get(exc.code, 4400))
        except (ValueError, TypeError, TimeoutError):
            await websocket.close(code=4400)
        except WebSocketDisconnect:
            pass
        finally:
            if uid:
                connections[uid] -= 1
                if not connections[uid]:
                    del connections[uid]

    @app.get('/')
    def index():
        return RedirectResponse('play.html')

    app.mount('/', StaticFiles(directory=Path(__file__).resolve().parents[1] / 'web'), name='web')
    return app
