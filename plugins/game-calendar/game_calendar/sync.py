"""Run once from cron/systemd: python -m game_calendar.sync."""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from .store import database_path, metadata, put_meta, writer
from .images import group_key, refresh

SOURCE = "https://kogda-igra.ru"


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value: object, limit: int = 4000) -> str:
    parser = PlainText()
    parser.feed(str(value or ""))
    return " ".join(" ".join(parser.parts).split())[:limit]


def safe_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        return value if url.scheme in {"https", "http"} and url.hostname and not url.username and not url.password else None
    except ValueError:
        return None


def normalize(raw: dict, expected_id: int) -> dict | None:
    if not isinstance(raw, dict):
        raise ValueError("Invalid event response")
    if not raw or str(raw.get("deleted_flag", 0)) == "1" or str(raw.get("access-denied", 0)) == "1" or raw.get("redirect_id"):
        return None
    if int(raw.get("id", 0)) != expected_id or not raw.get("name"):
        raise ValueError("Event identity missing or changed")
    start = None
    if raw.get("begin"):
        start = date.fromisoformat(raw["begin"])
    duration = max(1, min(366, int(raw.get("time") or 1)))
    players = raw.get("players_count")
    return {"id": expected_id, "name": plain(raw["name"], 300),
            "start_date": start.isoformat() if start else None,
            "end_date": (start + timedelta(days=duration - 1)).isoformat() if start else None,
            "region": plain(raw.get("sub_region_name"), 150),
            "type": plain(raw.get("game_type_name"), 100),
            "status": plain(raw.get("status_name"), 100),
            "venue": plain(raw.get("polygon_name"), 300),
            "organizer": plain(raw.get("mg"), 300),
            "description": plain(raw.get("comment")),
            "players": int(players) if players is not None and str(players).isdigit() else None,
            "website": safe_url(raw.get("uri")),
            "vk_group": group_key(raw.get("vk_club")) or (group_key(raw.get("uri")) if str(raw.get("uri", "")).startswith(("https://", "http://")) else None),
            "source_url": f"{SOURCE}/game/{expected_id}/"}


class Source:
    def __init__(self, delay: float = 0.2):
        self.delay = delay

    def fetch(self, path: str, as_json: bool = True):
        for attempt in range(3):
            try:
                time.sleep(self.delay)
                request = urllib.request.Request(SOURCE + path, headers={"User-Agent": "KvaChatCalendar/0.1 (+https://kvachat.ru)"})
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = response.read(5_000_001)
                    if len(data) > 5_000_000:
                        raise ValueError("Source response too large")
                    return json.loads(data) if as_json else data.decode("utf-8")
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)

    def listing(self, year: int) -> set[int]:
        # The public API has no list-by-year endpoint. HTML is used only to discover IDs.
        html = self.fetch(f"/{year}", as_json=False)
        ids = {int(value) for value in re.findall(r'href=["\']/game/(\d+)/?["\']', html)}
        if not ids:
            raise ValueError("Empty year index; keeping previous snapshot")
        return ids

    def changed(self, since: int) -> list[dict]:
        rows = self.fetch(f"/api/changed/{since}")
        if rows == {}:
            return []
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not str(row.get("id", "")).isdigit() for row in rows):
            raise ValueError("Invalid change feed")
        return rows

    def game(self, event_id: int) -> dict:
        return self.fetch(f"/api/game/{event_id}")


def sync(path: Path, source: Source, now: datetime | None = None, full: bool = False) -> int:
    now = now or datetime.now(timezone.utc)
    db = writer(path)
    started = False
    try:
        db.execute("BEGIN IMMEDIATE")  # One sync writer; readers continue using the previous WAL snapshot.
        started = True
        meta = metadata(db)
        ids = set()
        if full or meta.get("bootstrap_year") != now.year:
            ids = source.listing(now.year) | source.listing(now.year + 1)
        changed = source.changed(max(0, int(meta.get("cursor", now.timestamp())) - 300))
        ids.update(int(row["id"]) for row in changed)
        deleted = {int(row["id"]) for row in changed if str(row.get("deleted_flag")) == "1"}
        reconcile = full or now.timestamp() - meta.get("last_reconcile", 0) >= 7 * 86400
        # Weekly reconciliation catches entries omitted from the incremental feed.
        if reconcile or meta.get("event_schema", 1) < 2:
            ids.update(row[0] for row in db.execute("SELECT id FROM events"))
        for index, event_id in enumerate(sorted(ids)):
            raw = {} if event_id in deleted else source.game(event_id)
            target_id = event_id
            seen = {event_id}
            while raw.get("redirect_id"):
                target_id = int(raw["redirect_id"])
                if target_id in seen or len(seen) >= 5:
                    raise ValueError("Invalid event redirect chain")
                seen.add(target_id)
                raw = source.game(target_id)
            event = normalize(raw, target_id)
            if target_id != event_id:
                db.execute("DELETE FROM events WHERE id = ?", (event_id,))
            if event and (not event["start_date"] or now.year <= int(event["start_date"][:4]) <= now.year + 1):
                db.execute("INSERT OR REPLACE INTO events VALUES (?, ?)", (target_id, json.dumps(event, ensure_ascii=False)))
            else:
                db.execute("DELETE FROM events WHERE id = ?", (event_id,))
            if (index + 1) % 50 == 0:
                print(f"Fetched {index + 1}/{len(ids)}", flush=True)
        put_meta(db, "bootstrap_year", now.year)
        put_meta(db, "event_schema", 2)
        put_meta(db, "cursor", int(now.timestamp()))
        put_meta(db, "updated_at", now.isoformat())
        if reconcile:
            put_meta(db, "last_reconcile", int(now.timestamp()))
        put_meta(db, "last_error", None)
        db.commit()
        return len(ids)
    except Exception:
        db.rollback()
        if started:
            put_meta(db, "last_error", now.isoformat())
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="Rediscover IDs for the current and following year")
    parser.add_argument("--images-only", action="store_true", help="Refresh VK artwork without fetching event data")
    args = parser.parse_args()
    if not args.images_only:
        count = sync(database_path(), Source(), full=args.full)
        print(f"Calendar sync complete: {count} records checked", flush=True)
    try:
        print(f"VK artwork: {refresh(database_path())}", flush=True)
    except Exception:
        # Calendar data is already committed. Never print credential-bearing errors.
        print("VK artwork refresh failed; cached images retained", flush=True)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
