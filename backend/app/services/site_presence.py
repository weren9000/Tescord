from __future__ import annotations

from threading import Lock
from time import monotonic
from uuid import UUID


class SitePresenceManager:
    def __init__(self, ttl_seconds: float = 180.0) -> None:
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


class SharedSitePresenceManager:
    """The latest heartbeat from ANY device keeps a user online across workers."""
    def __init__(self, ttl_seconds=180):
        self.ttl = ttl_seconds

    def mark_active(self, user_id):
        from app.services.cluster import client, PREFIX
        script = """
        local now = tonumber(redis.call('TIME')[1])
        local old = tonumber(redis.call('ZSCORE',KEYS[1],ARGV[1]) or '0')
        redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2]),ARGV[1])
        if old <= now then return 1 else return 0 end
        """
        return bool(client().eval(script, 1, PREFIX + 'presence', str(user_id), self.ttl))

    def snapshot_user_ids(self):
        from app.services.cluster import client, PREFIX
        script = "return redis.call('ZRANGEBYSCORE',KEYS[1],'('..redis.call('TIME')[1],'+inf')"
        return {UUID(uid) for uid in client().eval(script, 1, PREFIX + 'presence')}

    def online_user_ids(self, user_ids):
        return self.snapshot_user_ids().intersection(user_ids)

    def collect_expired_user_ids(self):
        from app.services.cluster import client, PREFIX
        script = """
        local now=redis.call('TIME')[1]
        local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',now)
        redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
        return ids
        """
        return [UUID(uid) for uid in client().eval(script, 1, PREFIX + 'presence')]


from app.core.config import get_settings
if get_settings().redis_url:
    site_presence_manager = SharedSitePresenceManager()
