from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from anyio import from_thread
from fastapi import WebSocket
from sqlalchemy import select

from app.db.models import ServerMember
from app.db.session import SessionLocal
from app.services.workspace_events import (
    list_server_channels_for_user,
    list_server_members_for_user,
    list_server_voice_presence_for_user,
)


def _normalize_user_id(user_id: UUID | str) -> str:
    return str(user_id)


def _normalize_server_id(server_id: UUID | str | None) -> str | None:
    return str(server_id) if server_id is not None else None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class AppEventConnection:
    websocket: WebSocket
    active_server_id: str | None = None


class AppEventManager:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, AppEventConnection]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: UUID | str) -> str:
        connection_id = uuid4().hex
        normalized_user_id = _normalize_user_id(user_id)

        await websocket.accept()

        async with self._lock:
            user_connections = self._connections.setdefault(normalized_user_id, {})
            user_connections[connection_id] = AppEventConnection(websocket=websocket)

        return connection_id

    async def disconnect(self, user_id: UUID | str, connection_id: str) -> None:
        normalized_user_id = _normalize_user_id(user_id)

        async with self._lock:
            user_connections = self._connections.get(normalized_user_id)
            if user_connections is None:
                return

            user_connections.pop(connection_id, None)
            if not user_connections:
                self._connections.pop(normalized_user_id, None)

    async def set_active_server(
        self,
        user_id: UUID | str,
        connection_id: str,
        server_id: UUID | str | None,
    ) -> None:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_server_id = _normalize_server_id(server_id)

        async with self._lock:
            user_connections = self._connections.get(normalized_user_id)
            if user_connections is None:
                return

            connection = user_connections.get(connection_id)
            if connection is None:
                return

            connection.active_server_id = normalized_server_id

    async def broadcast(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            recipients = [
                (user_id, connection_id, connection.websocket)
                for user_id, user_connections in self._connections.items()
                for connection_id, connection in user_connections.items()
            ]

        await self._send_payload(recipients, payload)

    async def send_to_user(self, user_id: UUID | str, payload: dict[str, Any]) -> None:
        normalized_user_id = _normalize_user_id(user_id)

        async with self._lock:
            user_connections = self._connections.get(normalized_user_id, {})
            recipients = [
                (normalized_user_id, connection_id, connection.websocket)
                for connection_id, connection in user_connections.items()
            ]

        await self._send_payload(recipients, payload)

    async def send_to_users(self, user_ids: Iterable[UUID | str], payload: dict[str, Any]) -> None:
        normalized_user_ids = {_normalize_user_id(user_id) for user_id in user_ids}
        if not normalized_user_ids:
            return

        async with self._lock:
            recipients = [
                (user_id, connection_id, connection.websocket)
                for user_id in normalized_user_ids
                for connection_id, connection in self._connections.get(user_id, {}).items()
            ]

        await self._send_payload(recipients, payload)

    async def send_to_server(self, server_id: UUID | str, payload: dict[str, Any]) -> None:
        normalized_server_id = _normalize_server_id(server_id)
        if normalized_server_id is None:
            return

        async with self._lock:
            recipients = [
                (user_id, connection_id, connection.websocket)
                for user_id, user_connections in self._connections.items()
                for connection_id, connection in user_connections.items()
                if connection.active_server_id == normalized_server_id
            ]

        await self._send_payload(recipients, payload)

    async def send_to_user_on_server(
        self,
        user_id: UUID | str,
        server_id: UUID | str,
        payload: dict[str, Any],
    ) -> None:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_server_id = _normalize_server_id(server_id)
        if normalized_server_id is None:
            return

        async with self._lock:
            user_connections = self._connections.get(normalized_user_id, {})
            recipients = [
                (normalized_user_id, connection_id, connection.websocket)
                for connection_id, connection in user_connections.items()
                if connection.active_server_id == normalized_server_id
            ]

        await self._send_payload(recipients, payload)

    async def get_server_subscriber_user_ids(self, server_id: UUID | str) -> set[str]:
        normalized_server_id = _normalize_server_id(server_id)
        if normalized_server_id is None:
            return set()

        async with self._lock:
            return {
                user_id
                for user_id, user_connections in self._connections.items()
                if any(connection.active_server_id == normalized_server_id for connection in user_connections.values())
            }

    async def _send_payload(
        self,
        recipients: list[tuple[str, str, WebSocket]],
        payload: dict[str, Any],
    ) -> None:
        stale_connections: list[tuple[str, str]] = []

        for user_id, connection_id, websocket in recipients:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale_connections.append((user_id, connection_id))

        for user_id, connection_id in stale_connections:
            await self.disconnect(user_id, connection_id)


app_event_manager = AppEventManager()


def build_presence_updated_event(user_id: UUID | str, *, is_online: bool = True) -> dict[str, Any]:
    return {
        "type": "presence_updated",
        "user_id": _normalize_user_id(user_id),
        "is_online": is_online,
        "last_active_at": _utc_now_iso(),
    }


def build_message_created_event(
    server_id: UUID | str,
    message: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "message_created",
        "server_id": _normalize_user_id(server_id),
        "message": message,
    }


def build_servers_changed_event(*, reason: str) -> dict[str, Any]:
    return {
        "type": "servers_changed",
        "reason": reason,
    }


def build_channels_updated_event(
    server_id: UUID | str,
    channels: list[dict[str, Any]],
    *,
    reason: str,
) -> dict[str, Any]:
    return {
        "type": "channels_updated",
        "server_id": _normalize_user_id(server_id),
        "reason": reason,
        "channels": channels,
    }


def build_members_updated_event(
    server_id: UUID | str,
    members: list[dict[str, Any]],
    *,
    reason: str,
) -> dict[str, Any]:
    return {
        "type": "members_updated",
        "server_id": _normalize_user_id(server_id),
        "reason": reason,
        "members": members,
    }


def build_voice_presence_updated_event(
    server_id: UUID | str,
    voice_presence: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "type": "voice_presence_updated",
        "server_id": _normalize_user_id(server_id),
        "voice_presence": voice_presence,
    }


def build_voice_inbox_changed_event() -> dict[str, Any]:
    return {
        "type": "voice_inbox_changed",
    }


def build_voice_request_resolved_event(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "voice_request_resolved",
        "request": request,
    }


def _run_async_or_schedule(function, *args) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        from_thread.run(function, *args)
        return

    loop.create_task(function(*args))


async def publish_presence_updated(user_id: UUID | str, is_online: bool = True) -> None:
    normalized_user_id = _normalize_user_id(user_id)
    with SessionLocal() as db:
        server_ids = db.execute(
            select(ServerMember.server_id).where(ServerMember.user_id == UUID(normalized_user_id))
        ).scalars().all()

    if not server_ids:
        return

    payload = build_presence_updated_event(user_id, is_online=is_online)
    for server_id in server_ids:
        await app_event_manager.send_to_server(server_id, payload)


async def publish_message_created(server_id: UUID | str, message: dict[str, Any]) -> None:
    await app_event_manager.send_to_server(server_id, build_message_created_event(server_id, message))


async def publish_servers_changed(reason: str) -> None:
    await app_event_manager.broadcast(build_servers_changed_event(reason=reason))


async def publish_channels_updated(server_id: UUID | str, reason: str) -> None:
    normalized_server_id = _normalize_server_id(server_id)
    if normalized_server_id is None:
        return

    subscriber_user_ids = await app_event_manager.get_server_subscriber_user_ids(normalized_server_id)
    if not subscriber_user_ids:
        return

    server_uuid = UUID(normalized_server_id)
    payloads_by_user_id: dict[str, dict[str, Any]] = {}
    with SessionLocal() as db:
        for user_id in subscriber_user_ids:
            channels = [
                channel.model_dump(mode="json")
                for channel in list_server_channels_for_user(db, server_uuid, UUID(user_id))
            ]
            payloads_by_user_id[user_id] = build_channels_updated_event(normalized_server_id, channels, reason=reason)

    for user_id, payload in payloads_by_user_id.items():
        await app_event_manager.send_to_user_on_server(user_id, normalized_server_id, payload)


async def publish_members_updated(server_id: UUID | str, reason: str) -> None:
    normalized_server_id = _normalize_server_id(server_id)
    if normalized_server_id is None:
        return

    with SessionLocal() as db:
        members = [
            member.model_dump(mode="json")
            for member in list_server_members_for_user(db, UUID(normalized_server_id))
        ]

    payload = build_members_updated_event(normalized_server_id, members, reason=reason)
    await app_event_manager.send_to_server(normalized_server_id, payload)


async def publish_voice_presence_updated(server_id: UUID | str) -> None:
    normalized_server_id = _normalize_server_id(server_id)
    if normalized_server_id is None:
        return

    subscriber_user_ids = await app_event_manager.get_server_subscriber_user_ids(normalized_server_id)
    if not subscriber_user_ids:
        return

    server_uuid = UUID(normalized_server_id)
    payloads_by_user_id: dict[str, dict[str, Any]] = {}
    with SessionLocal() as db:
        for user_id in subscriber_user_ids:
            voice_presence = [
                item.model_dump(mode="json")
                for item in await list_server_voice_presence_for_user(db, server_uuid, UUID(user_id))
            ]
            payloads_by_user_id[user_id] = build_voice_presence_updated_event(normalized_server_id, voice_presence)

    for user_id, payload in payloads_by_user_id.items():
        await app_event_manager.send_to_user_on_server(user_id, normalized_server_id, payload)


async def publish_voice_inbox_changed(user_ids: Iterable[UUID | str]) -> None:
    await app_event_manager.send_to_users(user_ids, build_voice_inbox_changed_event())


async def publish_voice_request_resolved(user_id: UUID | str, request: dict[str, Any]) -> None:
    await app_event_manager.send_to_user(user_id, build_voice_request_resolved_event(request))


async def publish_server_changed(server_id: UUID | str, reason: str) -> None:
    await publish_channels_updated(server_id, reason)


def publish_presence_updated_from_sync(user_id: UUID | str, *, is_online: bool = True) -> None:
    _run_async_or_schedule(publish_presence_updated, user_id, is_online)


def publish_servers_changed_from_sync(*, reason: str) -> None:
    _run_async_or_schedule(publish_servers_changed, reason)


def publish_channels_updated_from_sync(server_id: UUID | str, *, reason: str) -> None:
    _run_async_or_schedule(publish_channels_updated, server_id, reason)


def publish_members_updated_from_sync(server_id: UUID | str, *, reason: str) -> None:
    _run_async_or_schedule(publish_members_updated, server_id, reason)


def publish_voice_presence_updated_from_sync(server_id: UUID | str) -> None:
    _run_async_or_schedule(publish_voice_presence_updated, server_id)


def publish_voice_inbox_changed_from_sync(user_ids: Iterable[UUID | str]) -> None:
    _run_async_or_schedule(publish_voice_inbox_changed, list(user_ids))


def publish_server_changed_from_sync(server_id: UUID | str, *, reason: str) -> None:
    _run_async_or_schedule(publish_server_changed, server_id, reason)
