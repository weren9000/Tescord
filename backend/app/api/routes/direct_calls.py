from __future__ import annotations

from app.api.dependencies.websocket_auth import authenticate_websocket, receive_authenticated_json

from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select

from app.api.dependencies.auth import get_current_user, bearer_scheme
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.models import User
from app.services.direct_call_sfu import issue_call_token
from app.db.models import FriendBlock
from app.db.session import SessionLocal
from app.services.direct_call_signaling import direct_call_signaling_manager
from app.services.direct_conversations import load_direct_conversation

router = APIRouter(prefix="/calls", tags=["calls"])


class CallTokenRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)


@router.post('/{call_id}/sfu-token')
async def create_direct_sfu_token(call_id: str, body: CallTokenRequest,
        current_user: User = Depends(get_current_user),
        credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    session_id = decode_access_token(credentials.credentials, get_settings().secret_key)['sid']
    return await issue_call_token(call_id, str(current_user.id), current_user.username, session_id, body.client_id)


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
    current_user = await authenticate_websocket(websocket)
    if current_user is None:
        return
    connection_id = ""
    client_id = websocket.query_params.get('client_id', '')[:100]
    with SessionLocal() as db:
        connection_id = await direct_call_signaling_manager.connect(
            websocket,
            user_id=str(current_user.id),
            nick=current_user.username,
            avatar_updated_at=current_user.avatar_updated_at,
            client_id=client_id,
        )

    user_id = str(current_user.id)

    try:
        while True:
            message = await receive_authenticated_json(websocket)
            message_type = message.get("type")

            if message_type == "call_request":
                if message.get('transport') != 'sfu' or not client_id:
                    await websocket.send_json({'type': 'error', 'detail': 'Обновите приложение для личных звонков'})
                    continue
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

                await direct_call_signaling_manager.request_call(user_id, target_user_id, connection_id)
                continue

            if message_type == "call_response":
                if message.get('action') == 'accept' and (message.get('transport') != 'sfu' or not client_id):
                    await websocket.send_json({'type': 'error', 'detail': 'Обновите приложение для личных звонков'})
                    continue
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
                    connection_id=connection_id,
                )
                if not handled:
                    await websocket.send_json({"type": "error", "detail": "Запрос на звонок уже неактуален"})
                continue

            if message_type == "hangup":
                call_id = message.get("call_id")
                if not isinstance(call_id, str) or not call_id:
                    await websocket.send_json({"type": "error", "detail": "Нужно указать call_id"})
                    continue

                await direct_call_signaling_manager.hangup(user_id, call_id, detail="Собеседник завершил звонок", client_id=client_id or connection_id)
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
