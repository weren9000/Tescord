from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.dependencies.auth import resolve_user_from_token
from app.db.session import SessionLocal
from app.services.direct_call_signaling import direct_call_signaling_manager

router = APIRouter(prefix="/calls", tags=["calls"])


@router.websocket("/ws")
async def connect_to_direct_calls(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    with SessionLocal() as db:
        try:
            current_user = resolve_user_from_token(token, db)
        except Exception:
            await websocket.close(code=4401, reason="Unauthorized")
            return

        await direct_call_signaling_manager.connect(
            websocket,
            user_id=str(current_user.id),
            nick=current_user.username,
            full_name=current_user.display_name,
            character_name=current_user.bio,
            avatar_updated_at=current_user.avatar_updated_at,
        )

    user_id = str(current_user.id)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "call_request":
                target_user_id = message.get("target_user_id")
                if not isinstance(target_user_id, str) or not target_user_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать target_user_id"})
                    continue

                await direct_call_signaling_manager.request_call(user_id, target_user_id)
                continue

            if message_type == "call_response":
                call_id = message.get("call_id")
                action = message.get("action")
                if not isinstance(call_id, str) or not call_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать call_id"})
                    continue

                if action not in {"accept", "reject"}:
                    await websocket.send_json({"type": "error", "detail": "Неизвестное действие ответа на звонок"})
                    continue

                handled = await direct_call_signaling_manager.respond_to_call(
                    user_id,
                    call_id,
                    accept=action == "accept",
                )
                if not handled:
                    await websocket.send_json({"type": "error", "detail": "Запрос на звонок уже неактуален"})
                continue

            if message_type in {"offer", "answer", "ice_candidate"}:
                call_id = message.get("call_id")
                target_user_id = message.get("target_user_id")
                if not isinstance(call_id, str) or not call_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать call_id"})
                    continue

                if not isinstance(target_user_id, str) or not target_user_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать target_user_id"})
                    continue

                relayed = await direct_call_signaling_manager.relay(
                    call_id=call_id,
                    source_user_id=user_id,
                    target_user_id=target_user_id,
                    message_type=message_type,
                    payload=message.get("payload"),
                )
                if not relayed:
                    await websocket.send_json({"type": "error", "detail": "Не удалось передать сигнал личного звонка"})
                continue

            if message_type == "hangup":
                call_id = message.get("call_id")
                if not isinstance(call_id, str) or not call_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать call_id"})
                    continue

                await direct_call_signaling_manager.hangup(user_id, call_id, detail="Собеседник завершил звонок")
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
        await direct_call_signaling_manager.disconnect(user_id, websocket)
