from __future__ import annotations

from threading import Lock
from time import monotonic
from uuid import UUID


class SitePresenceManager:
    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._last_seen: dict[UUID, float] = {}
        self._lock = Lock()

    def mark_active(self, user_id: UUID) -> bool:
        now = monotonic()
        with self._lock:
            was_online = now - self._last_seen.get(user_id, float('-inf')) <= self._ttl_seconds
            self._last_seen[user_id] = now
            return not was_online

    def online_user_ids(self, user_ids: list[UUID]) -> set[UUID]:
        now = monotonic()
        requested_ids = set(user_ids)

        with self._lock:
            # Only the expiry sweep removes entries, so reads cannot swallow offline events.
            return {user_id for user_id in requested_ids
                    if now - self._last_seen.get(user_id, float('-inf')) <= self._ttl_seconds}

    def collect_expired_user_ids(self) -> list[UUID]:
        now = monotonic()
        with self._lock:
            return self._cleanup_locked(now)

    def snapshot_user_ids(self) -> set[UUID]:
        with self._lock:
            now=monotonic()
            return {uid for uid,seen in self._last_seen.items() if now-seen<=self._ttl_seconds}

    def _cleanup_locked(self, now: float) -> list[UUID]:
        expired_user_ids = [
            user_id
            for user_id, last_seen in self._last_seen.items()
            if now - last_seen > self._ttl_seconds
        ]
        for user_id in expired_user_ids:
            self._last_seen.pop(user_id, None)
        return expired_user_ids


site_presence_manager = SitePresenceManager()
