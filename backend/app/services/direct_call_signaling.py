from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


@dataclass(slots=True)
class DirectCallPeer:
    user_id: str
    nick: str
    full_name: str
    character_name: str | None
    avatar_updated_at: datetime | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "nick": self.nick,
            "full_name": self.full_name,
            "character_name": self.character_name,
            "avatar_updated_at": self.avatar_updated_at.isoformat() if self.avatar_updated_at is not None else None,
        }


@dataclass(slots=True)
class DirectCallConnection:
    websocket: WebSocket
    peer: DirectCallPeer


@dataclass(slots=True)
class DirectCallSession:
    id: str
    caller_user_id: str
    callee_user_id: str
    status: str = "ringing"

    def other_user_id(self, user_id: str) -> str | None:
        if user_id == self.caller_user_id:
            return self.callee_user_id
        if user_id == self.callee_user_id:
            return self.caller_user_id
        return None

    def has_user(self, user_id: str) -> bool:
        return user_id in {self.caller_user_id, self.callee_user_id}


class DirectCallSignalingManager:
    def __init__(self) -> None:
        self._connections: dict[str, DirectCallConnection] = {}
        self._calls: dict[str, DirectCallSession] = {}
        self._user_to_call_id: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        *,
        user_id: str,
        nick: str,
        full_name: str,
        character_name: str | None,
        avatar_updated_at: datetime | None = None,
    ) -> None:
        await websocket.accept()

        previous_socket: WebSocket | None = None
        async with self._lock:
            previous_connection = self._connections.get(user_id)
            if previous_connection is not None:
                previous_socket = previous_connection.websocket

            self._connections[user_id] = DirectCallConnection(
                websocket=websocket,
                peer=DirectCallPeer(
                    user_id=user_id,
                    nick=nick,
                    full_name=full_name,
                    character_name=character_name,
                    avatar_updated_at=avatar_updated_at,
                ),
            )

        if previous_socket is not None and previous_socket is not websocket:
            try:
                await previous_socket.close(code=4000, reason="Replaced by a newer session")
            except Exception:
                pass

        await websocket.send_json({"type": "ready", "user_id": user_id})

    async def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        call_to_end: DirectCallSession | None = None
        async with self._lock:
            current_connection = self._connections.get(user_id)
            if current_connection is not None and current_connection.websocket is websocket:
                self._connections.pop(user_id, None)

            call_id = self._user_to_call_id.get(user_id)
            if call_id is not None:
                call_to_end = self._calls.get(call_id)

        if call_to_end is not None:
            await self._end_call(
                call_to_end,
                initiator_user_id=user_id,
                peer_payload={
                    "type": "call_ended",
                    "call_id": call_to_end.id,
                    "detail": "Собеседник отключился",
                },
            )

    async def request_call(self, caller_user_id: str, target_user_id: str) -> bool:
        if caller_user_id == target_user_id:
            await self._send_to_user(
                caller_user_id,
                {
                    "type": "error",
                    "detail": "Нельзя позвонить самому себе",
                },
            )
            return False

        async with self._lock:
            caller_connection = self._connections.get(caller_user_id)
            target_connection = self._connections.get(target_user_id)

            if caller_connection is None:
                return False

            if target_connection is None:
                target_payload = None
                caller_payload = {
                    "type": "call_rejected",
                    "call_id": None,
                    "detail": "Пользователь сейчас недоступен для личного звонка",
                }
            elif caller_user_id in self._user_to_call_id or target_user_id in self._user_to_call_id:
                target_payload = None
                caller_payload = {
                    "type": "call_rejected",
                    "call_id": None,
                    "detail": "У одного из участников уже есть активный звонок",
                }
            else:
                call_id = uuid4().hex
                call = DirectCallSession(
                    id=call_id,
                    caller_user_id=caller_user_id,
                    callee_user_id=target_user_id,
                )
                self._calls[call_id] = call
                self._user_to_call_id[caller_user_id] = call_id
                self._user_to_call_id[target_user_id] = call_id

                caller_payload = {
                    "type": "call_ringing",
                    "call_id": call_id,
                    "peer": target_connection.peer.to_payload(),
                }
                target_payload = {
                    "type": "incoming_call",
                    "call_id": call_id,
                    "peer": caller_connection.peer.to_payload(),
                }

        await self._send_to_user(caller_user_id, caller_payload)
        if target_payload is not None:
            await self._send_to_user(target_user_id, target_payload)

        return target_payload is not None

    async def respond_to_call(self, user_id: str, call_id: str, *, accept: bool) -> bool:
        async with self._lock:
            call = self._calls.get(call_id)
            if call is None or call.callee_user_id != user_id or call.status != "ringing":
                return False

            caller_connection = self._connections.get(call.caller_user_id)
            callee_connection = self._connections.get(call.callee_user_id)
            if caller_connection is None or callee_connection is None:
                self._drop_call_locked(call)
                return False

            if not accept:
                self._drop_call_locked(call)
                caller_payload = {
                    "type": "call_rejected",
                    "call_id": call.id,
                    "detail": "Собеседник отклонил личный звонок",
                }
                callee_payload = {
                    "type": "call_ended",
                    "call_id": call.id,
                    "detail": "Звонок отклонен",
                }
            else:
                call.status = "active"
                caller_payload = {
                    "type": "call_accepted",
                    "call_id": call.id,
                    "peer": callee_connection.peer.to_payload(),
                    "should_create_offer": True,
                }
                callee_payload = {
                    "type": "call_accepted",
                    "call_id": call.id,
                    "peer": caller_connection.peer.to_payload(),
                    "should_create_offer": False,
                }

        await self._send_to_user(call.caller_user_id, caller_payload)
        await self._send_to_user(call.callee_user_id, callee_payload)
        return True

    async def relay(
        self,
        *,
        call_id: str,
        source_user_id: str,
        target_user_id: str,
        message_type: str,
        payload: Any,
    ) -> bool:
        async with self._lock:
            call = self._calls.get(call_id)
            if call is None or call.status != "active" or not call.has_user(source_user_id):
                return False

            if call.other_user_id(source_user_id) != target_user_id:
                return False

        return await self._send_to_user(
            target_user_id,
            {
                "type": message_type,
                "call_id": call_id,
                "from_user_id": source_user_id,
                "payload": payload,
            },
        )

    async def hangup(self, user_id: str, call_id: str, *, detail: str = "Звонок завершен") -> bool:
        async with self._lock:
            call = self._calls.get(call_id)
            if call is None or not call.has_user(user_id):
                return False

        await self._end_call(
            call,
            initiator_user_id=user_id,
            peer_payload={
                "type": "call_ended",
                "call_id": call.id,
                "detail": detail,
            },
        )
        return True

    async def _end_call(
        self,
        call: DirectCallSession,
        *,
        initiator_user_id: str,
        peer_payload: dict[str, Any],
    ) -> None:
        peer_user_id = call.other_user_id(initiator_user_id)

        async with self._lock:
            active_call = self._calls.get(call.id)
            if active_call is None:
                return

            self._drop_call_locked(active_call)

        if peer_user_id is not None:
            await self._send_to_user(peer_user_id, peer_payload)

    async def _send_to_user(self, user_id: str, payload: dict[str, Any]) -> bool:
        async with self._lock:
            connection = self._connections.get(user_id)

        if connection is None:
            return False

        try:
            await connection.websocket.send_json(payload)
            return True
        except Exception:
            await self.disconnect(user_id, connection.websocket)
            return False

    def _drop_call_locked(self, call: DirectCallSession) -> None:
        self._calls.pop(call.id, None)
        self._user_to_call_id.pop(call.caller_user_id, None)
        self._user_to_call_id.pop(call.callee_user_id, None)


direct_call_signaling_manager = DirectCallSignalingManager()
