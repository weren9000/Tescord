from __future__ import annotations

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.api.dependencies.auth import resolve_user_from_token
from app.db.session import SessionLocal
from app.services.app_events import app_event_manager, publish_presence_updated
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/events", tags=["events"])


@router.websocket("/ws")
async def connect_app_events(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    with SessionLocal() as db:
        try:
            current_user = resolve_user_from_token(token, db)
        except HTTPException:
            await websocket.close(code=4401, reason="Unauthorized")
            return

    connection_id = await app_event_manager.connect(websocket, current_user.id)
    became_online = site_presence_manager.mark_active(current_user.id)
    await websocket.send_json(
        {
            "type": "ready",
            "user_id": str(current_user.id),
        }
    )
    if became_online:
        await publish_presence_updated(current_user.id)

    try:
        while True:
            payload = await websocket.receive_json()
            message_type = payload.get("type")

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if message_type == "activity":
                became_online = site_presence_manager.mark_active(current_user.id)
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

                await app_event_manager.set_active_server(current_user.id, connection_id, server_id)
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
