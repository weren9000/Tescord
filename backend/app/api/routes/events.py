from __future__ import annotations
import asyncio

from app.api.dependencies.websocket_auth import authenticate_websocket, receive_authenticated_json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.api.dependencies.auth import resolve_user_from_token
from app.db.session import SessionLocal
from app.services.app_events import app_event_manager, publish_presence_updated
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/events", tags=["events"])


@router.websocket("/ws")
async def connect_app_events(websocket: WebSocket) -> None:
    current_user = await authenticate_websocket(websocket)
    if current_user is None:
        return

    connection_id = await app_event_manager.connect(websocket, current_user.id)
    try:
        became_online = await asyncio.to_thread(site_presence_manager.mark_active, current_user.id)
        await websocket.send_json(
            {
                "type": "ready",
                "user_id": str(current_user.id),
            }
        )
        if became_online:
            await publish_presence_updated(current_user.id)
        while True:
            payload = await receive_authenticated_json(websocket)
            message_type = payload.get("type")

            if message_type == "ping":
                # A live authenticated client is online even when its window is hidden.
                became_online = await asyncio.to_thread(site_presence_manager.mark_active, current_user.id)
                if became_online:
                    await publish_presence_updated(current_user.id)
                await websocket.send_json({"type": "pong"})
                continue

            if message_type == "activity":
                became_online = await asyncio.to_thread(site_presence_manager.mark_active, current_user.id)
                if became_online:
                    await publish_presence_updated(current_user.id)
                continue

            if message_type == "subscribe_server":
                server_id = payload.get("server_id")
                if server_id is not None and not isinstance(server_id, str):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "detail": "server_id must be a string or null",
                        }
                    )
                    continue

                allowed = await app_event_manager.set_active_server(current_user.id, connection_id, server_id)
                if not allowed:
                    await websocket.send_json({"type": "error", "detail": "Access denied"})
                continue

            await websocket.send_json(
                {
                    "type": "error",
                    "detail": f"Unsupported event message: {message_type!r}",
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await app_event_manager.disconnect(current_user.id, connection_id)
