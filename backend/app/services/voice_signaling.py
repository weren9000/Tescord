from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


@dataclass(slots=True)
class VoiceParticipant:
    id: str
    user_id: str
    public_id: int
    nick: str
    avatar_updated_at: datetime | None = None
    muted: bool = False
    owner_muted: bool = False

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "public_id": self.public_id,
            "nick": self.nick,
            "avatar_updated_at": self.avatar_updated_at.isoformat() if self.avatar_updated_at is not None else None,
            "muted": self.muted,
            "owner_muted": self.owner_muted,
        }


@dataclass(slots=True)
class VoiceConnection:
    websocket: WebSocket
    participant: VoiceParticipant


class VoiceSignalingManager:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, VoiceConnection]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        channel_id: str,
        *,
        user_id: str,
        public_id: int,
        nick: str,
        avatar_updated_at: datetime | None = None,
        owner_muted: bool = False,
    ) -> VoiceParticipant:
        participant = VoiceParticipant(
            id=uuid4().hex,
            user_id=user_id,
            public_id=public_id,
            nick=nick,
            avatar_updated_at=avatar_updated_at,
            owner_muted=owner_muted,
        )

        await websocket.accept()

        async with self._lock:
            room = self._rooms.setdefault(channel_id, {})
            existing_participants = [connection.participant.to_payload() for connection in room.values()]
            room[participant.id] = VoiceConnection(websocket=websocket, participant=participant)

        await websocket.send_json(
            {
                "type": "room_state",
                "self_id": participant.id,
                "self_participant": participant.to_payload(),
                "participants": existing_participants,
            }
        )
        await self._broadcast(
            channel_id,
            {
                "type": "peer_joined",
                "participant": participant.to_payload(),
            },
            exclude_participant_id=participant.id,
        )

        return participant

    async def disconnect(
        self,
        channel_id: str,
        participant_id: str,
        *,
        close_socket: bool = False,
        code: int = 4003,
        reason: str = "Voice access revoked",
    ) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None or participant_id not in room:
                return

            connection = room.pop(participant_id)
            if not room:
                self._rooms.pop(channel_id, None)

        if close_socket:
            try:
                await connection.websocket.close(code=code, reason=reason)
            except Exception:
                pass

        await self._broadcast(
            channel_id,
            {
                "type": "peer_left",
                "participant_id": participant_id,
            },
            exclude_participant_id=participant_id,
        )

    async def relay(self, channel_id: str, *, source_id: str, target_id: str, message_type: str, payload: Any) -> bool:
        target_connection = await self._get_connection(channel_id, target_id)
        if target_connection is None:
            return False

        try:
            await target_connection.websocket.send_json(
                {
                    "type": message_type,
                    "from_id": source_id,
                    "payload": payload,
                }
            )
            return True
        except Exception:
            await self.disconnect(channel_id, target_id)
            return False

    async def update_mute_state(self, channel_id: str, participant_id: str, muted: bool) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return

            connection = room.get(participant_id)
            if connection is None:
                return

            connection.participant.muted = muted

        await self._broadcast(
            channel_id,
            {
                "type": "mute_state",
                "participant_id": participant_id,
                "muted": muted,
            },
            exclude_participant_id=participant_id,
        )

    async def update_owner_mute_state(self, channel_id: str, user_id: str, owner_muted: bool) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return

            affected_participant_ids: list[str] = []
            for connection in room.values():
                if connection.participant.user_id != user_id:
                    continue

                connection.participant.owner_muted = owner_muted
                affected_participant_ids.append(connection.participant.id)

        for participant_id in affected_participant_ids:
            await self._broadcast(
                channel_id,
                {
                    "type": "owner_mute_state",
                    "participant_id": participant_id,
                    "owner_muted": owner_muted,
                },
            )

    async def snapshot_rooms(self, channel_ids: set[str] | None = None) -> dict[str, list[dict[str, Any]]]:
        async with self._lock:
            snapshot: dict[str, list[dict[str, Any]]] = {}
            for channel_id, room in self._rooms.items():
                if channel_ids is not None and channel_id not in channel_ids:
                    continue

                participants = [connection.participant.to_payload() for connection in room.values()]
                if participants:
                    snapshot[channel_id] = participants

            return snapshot

    async def _get_connection(self, channel_id: str, participant_id: str) -> VoiceConnection | None:
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return None

            return room.get(participant_id)

    async def _broadcast(self, channel_id: str, payload: dict[str, Any], *, exclude_participant_id: str | None = None) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id, {})
            recipients = [
                connection
                for participant_id, connection in room.items()
                if participant_id != exclude_participant_id
            ]

        stale_participants: list[str] = []
        for connection in recipients:
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                stale_participants.append(connection.participant.id)

        for participant_id in stale_participants:
            await self.disconnect(channel_id, participant_id)

    async def disconnect_user_sessions(self, channel_id: str, user_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(channel_id, {})
            participant_ids = [
                participant_id
                for participant_id, connection in room.items()
                if connection.participant.user_id == user_id
            ]

        for participant_id in participant_ids:
            await self.disconnect(
                channel_id,
                participant_id,
                close_socket=True,
                reason="Voice access revoked",
            )

    async def disconnect_channel_sessions(
        self,
        channel_id: str,
        *,
        code: int = 1012,
        reason: str = "Voice channel removed",
    ) -> None:
        async with self._lock:
            room = self._rooms.pop(channel_id, {})
            connections = list(room.values())

        for connection in connections:
            try:
                await connection.websocket.close(code=code, reason=reason)
            except Exception:
                pass


voice_signaling_manager = VoiceSignalingManager()
