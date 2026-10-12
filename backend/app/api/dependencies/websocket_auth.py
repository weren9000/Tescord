"""Authenticate in a bounded first frame; credentials never appear in URLs."""
import asyncio
import json
import time

from fastapi import HTTPException, WebSocket, WebSocketDisconnect

from app.api.dependencies.auth import resolve_user_from_token
from app.core.config import get_settings
from app.db.session import SessionLocal


def _resolve(token: str):
    with SessionLocal() as db:
        return resolve_user_from_token(token, db)


async def authenticate_websocket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if origin and origin not in get_settings().cors_origins:
        await websocket.close(code=4403)
        return None
    await websocket.accept()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(raw.encode("utf-8")) > 8192:
            raise ValueError("Authentication frame too large")
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("type") != "authenticate" or not isinstance(payload.get("token"), str):
            raise ValueError("Authentication required")
        user = await asyncio.to_thread(_resolve, payload["token"])
        websocket.state.auth_token = payload["token"]
        websocket.state.auth_checked_at = time.monotonic()
        websocket.state.frame_window = time.monotonic()
        websocket.state.frame_count = 0
        return user
    except (HTTPException, ValueError, asyncio.TimeoutError, WebSocketDisconnect):
        try:
            await websocket.close(code=4401, reason="Authentication required")
        except RuntimeError:
            pass
        return None


async def receive_authenticated_json(websocket: WebSocket) -> dict:
    while True:
        now = time.monotonic()
        if now - websocket.state.auth_checked_at >= 5:
            try:
                await asyncio.to_thread(_resolve, websocket.state.auth_token)
            except HTTPException:
                await websocket.close(code=4401, reason="Session expired or revoked")
                raise WebSocketDisconnect(4401)
            websocket.state.auth_checked_at = now
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        except asyncio.TimeoutError:
            continue
        if now - websocket.state.frame_window >= 1:
            websocket.state.frame_window = now
            websocket.state.frame_count = 0
        websocket.state.frame_count += 1
        if len(raw.encode("utf-8")) > 65536 or websocket.state.frame_count > 60:
            await websocket.close(code=1008, reason="Message limit exceeded")
            raise WebSocketDisconnect(1008)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("Object required")
            return payload
        except ValueError:
            await websocket.close(code=1007, reason="Invalid message")
            raise WebSocketDisconnect(1007)
