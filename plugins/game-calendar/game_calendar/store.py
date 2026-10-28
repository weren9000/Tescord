from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def database_path() -> Path:
    return Path(os.environ.get("KVA_CALENDAR_DB", "data/calendar.sqlite3")).resolve()


def writer(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=0, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    return db


def put_meta(db: sqlite3.Connection, key: str, value: object) -> None:
    db.execute("INSERT OR REPLACE INTO metadata VALUES (?, ?)", (key, json.dumps(value)))


def metadata(db: sqlite3.Connection) -> dict:
    return {key: json.loads(value) for key, value in db.execute("SELECT key, value FROM metadata")}


def snapshot(path: Path | None = None) -> dict:
    path = path or database_path()
    events, meta = [], {}
    if path.exists():
        db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)
        try:
            db.execute("BEGIN")
            meta = metadata(db)
            events = [json.loads(row[0]) for row in db.execute("SELECT payload FROM events")]
            media = meta.get("vk_media", {})
            for event in events:
                artwork = media.get(event.get("vk_group"))
                if artwork:
                    event["image"] = {"url": "/plugins/game-calendar/images/" + artwork["file"],
                                      "kind": artwork["kind"], "source_url": artwork["source_url"]}
        finally:
            db.close()
    updated = meta.get("updated_at")
    stale = not updated or (datetime.now(timezone.utc) - datetime.fromisoformat(updated)).total_seconds() > 36 * 3600
    return {"events": sorted(events, key=lambda e: (e["start_date"] or "9999", e["name"], e["id"])),
            "updated_at": updated, "stale": stale, "ready": bool(updated),
            "last_attempt_failed": bool(meta.get("last_error")), "source": "https://kogda-igra.ru/"}
