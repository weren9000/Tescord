from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from starlette.websockets import WebSocketState
from fastapi import WebSocket


@dataclass(slots=True)
class DirectCallPeer:
    user_id: str
    nick: str
    avatar_updated_at: datetime | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "nick": self.nick,
            "avatar_updated_at": self.avatar_updated_at.isoformat() if self.avatar_updated_at is not None else None,
        }


@dataclass(slots=True)
class DirectCallConnection:
    id: str
    websocket: WebSocket
    peer: DirectCallPeer
    client_id: str = ''


@dataclass(slots=True)
class DirectCallSession:
    id: str
    caller_user_id: str
    callee_user_id: str
    status: str = "ringing"
    owners: dict[str, str] = field(default_factory=dict)
    peers: dict[str, DirectCallPeer] = field(default_factory=dict)

    def other_user_id(self, user_id: str) -> str | None:
        if user_id == self.caller_user_id:
            return self.callee_user_id
        if user_id == self.callee_user_id:
            return self.caller_user_id
        return None

    def has_user(self, user_id: str) -> bool:
        return user_id in {self.caller_user_id, self.callee_user_id}


class DirectCallSignalingManager:
    async def analytics_participants(self) -> dict[str, str]:
        async with self._lock:
            return {uid:call.id for call in self._calls.values() if call.status == 'active' for uid in (call.caller_user_id,call.callee_user_id)}

    def __init__(self) -> None:
        self._connections: dict[str, dict[str, DirectCallConnection]] = {}
        self._calls: dict[str, DirectCallSession] = {}
        self._user_to_call_id: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._timers: dict[str, asyncio.Task] = {}
        self._disconnect_timers: dict[tuple[str, str], asyncio.Task] = {}

    def media_allowed(self, call_id: str, user_id: str, client_id: str) -> bool:
        call = self._calls.get(call_id)
        return bool(call and call.status == 'active' and call.owners.get(user_id) == client_id)

    def _accepted_payload(self, call, user_id):
        return {'type': 'call_accepted', 'call_id': call.id, 'transport': 'sfu',
                'peer': call.peers[call.other_user_id(user_id)].to_payload()}

    async def _expire_ringing(self, call_id, user_id):
        await asyncio.sleep(45)
        await self.hangup(user_id, call_id, detail='Нет ответа')

    async def _expire_disconnect(self, call_id, key):
        try:
            await asyncio.sleep(20)
            await self.hangup(key[0], call_id, detail='Собеседник отключился')
        finally:
            if self._disconnect_timers.get(key) is asyncio.current_task():
                self._disconnect_timers.pop(key, None)

    async def connect(
        self,
        websocket: WebSocket,
        *,
        user_id: str,
        nick: str,
        avatar_updated_at: datetime | None = None,
        client_id: str = '',
    ) -> str:
        if websocket.application_state != WebSocketState.CONNECTED:
            await websocket.accept()
        connection_id = uuid4().hex
        client_id = client_id or connection_id

        async with self._lock:
            user_connections = self._connections.setdefault(user_id, {})
            user_connections[connection_id] = DirectCallConnection(
                id=connection_id,
                client_id=client_id,
                websocket=websocket,
                peer=DirectCallPeer(
                    user_id=user_id,
                    nick=nick,
                    avatar_updated_at=avatar_updated_at,
                ),
            )

            timer = self._disconnect_timers.pop((user_id, client_id), None)
            if timer:
                timer.cancel()
            call = self._calls.get(self._user_to_call_id.get(user_id, ''))
            restored = None
            if call and call.owners.get(user_id) == client_id:
                restored = self._accepted_payload(call, user_id) if call.status == 'active' else {
                    'type': 'call_ringing', 'call_id': call.id, 'peer': call.peers[call.other_user_id(user_id)].to_payload()}
            elif call and call.status == 'ringing' and call.callee_user_id == user_id:
                restored = {'type': 'incoming_call', 'call_id': call.id, 'peer': call.peers[call.caller_user_id].to_payload()}
        await websocket.send_json({"type": "ready", "user_id": user_id, 'call_id': call.id if restored else None})
        if restored:
            await websocket.send_json(restored)
        return connection_id

    async def disconnect(self, user_id: str, connection_id: str, websocket: WebSocket) -> None:
        current_connection = None
        async with self._lock:
            current_connections = self._connections.get(user_id)
            if current_connections is not None:
                current_connection = current_connections.get(connection_id)
                if current_connection is not None and current_connection.websocket is websocket:
                    current_connections.pop(connection_id, None)
                    if not current_connections:
                        self._connections.pop(user_id, None)

            if current_connection is not None:
                call_id = self._user_to_call_id.get(user_id)
                if call_id is not None:
                    call = self._calls.get(call_id)
                    client_id = current_connection.client_id
                    if call and call.owners.get(user_id) == client_id and not any(c.client_id == client_id for c in (self._connections.get(user_id) or {}).values()):
                        key = (user_id, client_id)
                        self._disconnect_timers[key] = asyncio.create_task(self._expire_disconnect(call_id, key))

    async def request_call(self, caller_user_id: str, target_user_id: str, connection_id: str) -> bool:
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
            caller_connections = self._connections.get(caller_user_id) or {}
            target_connections = self._connections.get(target_user_id) or {}
            caller_connection = caller_connections.get(connection_id)
            target_connection = next(iter(target_connections.values()), None)

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
                    owners={caller_user_id: caller_connection.client_id},
                    peers={caller_user_id: caller_connection.peer, target_user_id: target_connection.peer},
                )
                self._calls[call_id] = call
                self._user_to_call_id[caller_user_id] = call_id
                self._user_to_call_id[target_user_id] = call_id
                self._timers[call_id] = asyncio.create_task(self._expire_ringing(call_id, caller_user_id))

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

        await self._send_to_user(caller_user_id, caller_payload, client_id=caller_connection.client_id)
        if target_payload is not None:
            await self._send_to_user(target_user_id, target_payload)

        return target_payload is not None

    async def respond_to_call(self, user_id: str, call_id: str, *, accept: bool, connection_id: str) -> bool:
        async with self._lock:
            call = self._calls.get(call_id)
            if call is None or call.callee_user_id != user_id or call.status != "ringing":
                return False

            callee_connections = self._connections.get(call.callee_user_id) or {}
            callee_connection = callee_connections.get(connection_id)
            if callee_connection is None:
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
                call.owners[user_id] = callee_connection.client_id
                timer = self._timers.pop(call.id, None)
                if timer:
                    timer.cancel()

        if accept:
            for uid in (call.caller_user_id, call.callee_user_id):
                await self._send_to_user(uid, self._accepted_payload(call, uid), client_id=call.owners[uid])
            await self._send_to_user(user_id, {'type': 'call_ended', 'call_id': call.id, 'detail': 'Ответили на другом устройстве'}, exclude_client_id=callee_connection.client_id)
        else:
            await self._send_to_user(call.caller_user_id, caller_payload)
            await self._send_to_user(call.callee_user_id, callee_payload)
        return True

    async def hangup(self, user_id: str, call_id: str, *, detail: str = "Звонок завершен", client_id: str | None = None) -> bool:
        async with self._lock:
            call = self._calls.get(call_id)
            if call is None or not call.has_user(user_id):
                return False
            if client_id and call.owners.get(user_id) != client_id:
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
        await self._send_to_user(initiator_user_id, peer_payload)
        if call.status == 'active':
            from app.services.direct_call_sfu import delete_call_room
            await delete_call_room(call.id)

    async def _send_to_user(self, user_id: str, payload: dict[str, Any], *, client_id=None, exclude_client_id=None) -> bool:
        async with self._lock:
            connections = list((self._connections.get(user_id) or {}).values())

        if not connections:
            return False

        delivered = False
        stale_connections: list[DirectCallConnection] = []
        for connection in connections:
            if client_id and connection.client_id != client_id:
                continue
            if exclude_client_id and connection.client_id == exclude_client_id:
                continue
            try:
                await connection.websocket.send_json(payload)
                delivered = True
            except Exception:
                stale_connections.append(connection)

        for connection in stale_connections:
            await self.disconnect(user_id, connection.id, connection.websocket)

        return delivered

    def _drop_call_locked(self, call: DirectCallSession) -> None:
        timer = self._timers.pop(call.id, None)
        if timer and timer is not asyncio.current_task():
            timer.cancel()
        self._calls.pop(call.id, None)
        self._user_to_call_id.pop(call.caller_user_id, None)
        self._user_to_call_id.pop(call.callee_user_id, None)


direct_call_signaling_manager = DirectCallSignalingManager()
