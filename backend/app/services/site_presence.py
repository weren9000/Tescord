from __future__ import annotations

from threading import Lock
from time import monotonic
from uuid import UUID


class SitePresenceManager:
    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._last_seen: dict[UUID, float] = {}
        self._lock = Lock()

    def mark_active(self, user_id: UUID) -> None:
        now = monotonic()
        with self._lock:
            self._cleanup_locked(now)
            self._last_seen[user_id] = now

    def online_user_ids(self, user_ids: list[UUID]) -> set[UUID]:
        now = monotonic()
        requested_ids = set(user_ids)

        with self._lock:
            self._cleanup_locked(now)
            return {user_id for user_id in requested_ids if user_id in self._last_seen}

    def _cleanup_locked(self, now: float) -> None:
        expired_user_ids = [
            user_id
            for user_id, last_seen in self._last_seen.items()
            if now - last_seen > self._ttl_seconds
        ]
        for user_id in expired_user_ids:
            self._last_seen.pop(user_id, None)


site_presence_manager = SitePresenceManager()
