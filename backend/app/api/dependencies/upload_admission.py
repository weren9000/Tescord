"""Authenticate multipart requests before Starlette spools their file bodies."""
import asyncio

from fastapi import HTTPException
from starlette.responses import JSONResponse

from app.api.dependencies.auth import resolve_user_from_token
from app.core.config import get_settings
from app.db.session import SessionLocal


def _authenticate(token, path=''):
    with SessionLocal() as db:
        if path == get_settings().api_prefix + '/rooms/uploads':
            from app.services.meeting_rooms import principal
            principal(db, token)
            return
        resolve_user_from_token(token, db)


class UploadTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, 'Upload too large')


class UploadAdmissionMiddleware:
    def __init__(self, app):
        self.app = app
        self.slots = asyncio.Semaphore(4)

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get('headers', []))
        if scope['type'] != 'http' or not headers.get(b'content-type', b'').lower().startswith(b'multipart/form-data'):
            return await self.app(scope, receive, send)
        authorization = headers.get(b'authorization', b'').decode('latin-1')
        try:
            if not authorization.startswith('Bearer '):
                raise HTTPException(401, 'Authentication required')
            await asyncio.to_thread(_authenticate, authorization[7:], scope.get('path', ''))
        except HTTPException as exc:
            return await JSONResponse({'detail': exc.detail}, status_code=exc.status_code)(scope, receive, send)
        maximum = get_settings().max_message_upload_bytes + 1024 * 1024
        try:
            length = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await JSONResponse({'detail': 'Invalid content length'}, status_code=400)(scope, receive, send)
        if length > maximum:
            return await JSONResponse({'detail': 'Upload too large'}, status_code=413)(scope, receive, send)
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=0.2)
        except asyncio.TimeoutError:
            return await JSONResponse({'detail': 'Upload capacity reached'}, status_code=429, headers={'Retry-After': '5'})(scope, receive, send)
        total = 0
        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > maximum:
                raise UploadTooLarge()
            return message
        try:
            await self.app(scope, bounded_receive, send)
        except UploadTooLarge:
            await JSONResponse({'detail': 'Upload too large'}, status_code=413)(scope, receive, send)
        finally:
            self.slots.release()
