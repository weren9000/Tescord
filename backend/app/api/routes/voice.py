from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.api.dependencies.auth import resolve_user_from_token
from app.db.models import Channel, ChannelType
from app.db.session import SessionLocal
from app.services.voice_signaling import voice_signaling_manager

router = APIRouter(prefix="/voice", tags=["voice"])


@router.websocket("/channels/{channel_id}/ws")
async def connect_to_voice_channel(websocket: WebSocket, channel_id: UUID) -> None:
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

        channel = db.get(Channel, channel_id)
        if channel is None or channel.type != ChannelType.VOICE:
            await websocket.close(code=4404, reason="Voice channel not found")
            return

        participant = await voice_signaling_manager.connect(
            websocket,
            str(channel.id),
            user_id=str(current_user.id),
            nick=current_user.username,
            full_name=current_user.display_name,
        )

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type in {"offer", "answer", "ice_candidate"}:
                target_id = message.get("target_id")
                if not isinstance(target_id, str) or not target_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать target_id"})
                    continue

                relayed = await voice_signaling_manager.relay(
                    str(channel_id),
                    source_id=participant.id,
                    target_id=target_id,
                    message_type=message_type,
                    payload=message.get("payload"),
                )
                if not relayed:
                    await websocket.send_json({"type": "error", "detail": "Участник уже отключился"})
                continue

            if message_type == "mute_state":
                await voice_signaling_manager.update_mute_state(
                    str(channel_id),
                    participant.id,
                    bool(message.get("muted")),
                )
                continue

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            await websocket.send_json(
                {
                    "type": "error",
                    "detail": f"Неподдерживаемый тип сообщения: {message_type!r}",
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await voice_signaling_manager.disconnect(str(channel_id), participant.id)
