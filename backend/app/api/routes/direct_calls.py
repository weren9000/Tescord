from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, or_, select

from app.api.dependencies.auth import resolve_user_from_token
from app.db.models import FriendBlock
from app.db.session import SessionLocal
from app.services.direct_call_signaling import direct_call_signaling_manager
from app.services.direct_conversations import load_direct_conversation

router = APIRouter(prefix="/calls", tags=["calls"])


def _can_start_direct_call(current_user_id: UUID, target_user_id: UUID) -> bool:
    with SessionLocal() as db:
        has_block = (
            db.execute(
                select(FriendBlock.id).where(
                    or_(
                        and_(
                            FriendBlock.blocker_user_id == current_user_id,
                            FriendBlock.blocked_user_id == target_user_id,
                        ),
                        and_(
                            FriendBlock.blocker_user_id == target_user_id,
                            FriendBlock.blocked_user_id == current_user_id,
                        ),
                    )
                )
            ).scalar_one_or_none()
            is not None
        )
        if has_block:
            return False

        return load_direct_conversation(db, current_user_id, target_user_id) is not None


@router.websocket("/ws")
async def connect_to_direct_calls(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    connection_id = ""

    with SessionLocal() as db:
        try:
            current_user = resolve_user_from_token(token, db)
        except Exception:
            await websocket.close(code=4401, reason="Unauthorized")
            return

        connection_id = await direct_call_signaling_manager.connect(
            websocket,
            user_id=str(current_user.id),
            nick=current_user.username,
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

                try:
                    target_user_uuid = UUID(target_user_id)
                except ValueError:
                    await websocket.send_json({"type": "error", "detail": "Некорректный target_user_id"})
                    continue

                if not _can_start_direct_call(current_user.id, target_user_uuid):
                    await websocket.send_json({"type": "error", "detail": "Личный звонок доступен только для друзей"})
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

            if message_type in {"offer", "answer", "ice_candidate", "screen_share_state", "camera_state"}:
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
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await direct_call_signaling_manager.disconnect(user_id, connection_id, websocket)
