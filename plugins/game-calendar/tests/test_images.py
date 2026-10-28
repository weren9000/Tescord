import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from fastapi.testclient import TestClient

from game_calendar.app import app
from game_calendar.images import VK, candidates, download, group_key, refresh, save_image
from game_calendar.store import metadata, snapshot, writer
from game_calendar.sync import normalize
from test_calendar import FakeSource, NOW, game
from game_calendar.sync import sync


def png():
    out = io.BytesIO()
    Image.new("RGB", (120, 48), "#754bff").save(out, "PNG")
    return out.getvalue()


class FakeVK:
    def __init__(self):
        self.calls = []
        self.result = [{"id": 42, "screen_name": "mygroup", "is_closed": 0,
                        "cover": {"enabled": 1, "images": [{"width": 1000, "url": "https://sun9.userapi.com/cover"}]},
                        "photo_200": "https://sun9.userapi.com/avatar"}]

    def groups(self, keys):
        self.calls.append(keys)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "calendar.sqlite3"
        source = FakeSource()
        source.games[1] = game(vk_club="club42")
        sync(self.path, source, NOW)
        self.client = FakeVK()

    def tearDown(self):
        self.temp.cleanup()

    def test_normalize_groups(self):
        for value in ["club42", "event42", "public42", "42", "https://vk.com/club42"]:
            self.assertEqual(group_key(value), "42")
        self.assertEqual(group_key("https://vk.ru/MyGroup"), "mygroup")
        for value in ["https://evil.test/club42", "https://vk.com@evil.test/club42", "../club42", None]:
            self.assertIsNone(group_key(value))
        self.assertEqual(normalize(game(uri="https://vk.com/mygroup"), 1)["vk_group"], "mygroup")

    def test_download_only_vk_cdn_without_redirects(self):
        for url in ["http://sun.userapi.com/a", "https://127.0.0.1/a", "https://userapi.com.evil.test/a", "https://user:pass@sun.userapi.com/a", "https://sun.userapi.com:999/a"]:
            with self.assertRaises(ValueError):
                download(url)

    def test_cache_public_api_and_immutable_file(self):
        result = refresh(self.path, self.client, lambda _: png())
        self.assertEqual(result["images"], 1)
        event = snapshot(self.path)["events"][0]
        self.assertEqual(event["image"]["kind"], "cover")
        self.assertNotIn("userapi", json.dumps(event))
        with patch.dict(os.environ, {"KVA_CALENDAR_DB": str(self.path)}):
            client = TestClient(app)
            response = client.get(event["image"]["url"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "image/webp")
            self.assertIn("immutable", response.headers["cache-control"])
            self.assertEqual(client.get("/plugins/game-calendar/images/calendar.sqlite3").status_code, 404)
        def forbidden(_):
            self.fail("Unchanged image must not be downloaded again")
        refresh(self.path, self.client, forbidden)

    def test_avatar_fallback_and_error_preserves_cache(self):
        def fetch(url):
            if url.endswith("cover"):
                raise OSError("missing")
            return png()
        refresh(self.path, self.client, fetch)
        before = snapshot(self.path)["events"][0]["image"]
        self.assertEqual(before["kind"], "avatar")
        self.client.result = RuntimeError("unavailable")
        self.assertEqual(refresh(self.path, self.client, fetch)["status"], "partial")
        self.assertEqual(snapshot(self.path)["events"][0]["image"], before)

    def test_closed_group_removes_artwork(self):
        refresh(self.path, self.client, lambda _: png())
        self.client.result[0]["is_closed"] = 1
        refresh(self.path, self.client, lambda _: png())
        self.assertNotIn("image", snapshot(self.path)["events"][0])

    def test_multiple_games_share_group_lookup_and_image(self):
        db = writer(self.path)
        db.execute("INSERT INTO events VALUES (?, ?)", (2, json.dumps(normalize(game(2, vk_club="club42"), 2))))
        db.close()
        refresh(self.path, self.client, lambda _: png())
        self.assertEqual(self.client.calls, [["42"]])
        self.assertEqual(len(list((self.path.parent / "images").glob("*.webp"))), 1)

    def test_bad_images_rejected(self):
        for data in [b'<svg onload="alert(1)"/>', b'x' * 8_000_001]:
            with self.assertRaises(Exception):
                save_image(data, self.path.parent / "images")

    def test_concurrent_aliases_share_content_without_temp_file_race(self):
        db = writer(self.path)
        db.execute("INSERT INTO events VALUES (?, ?)", (2, json.dumps(normalize(game(2, vk_club="mygroup"), 2))))
        db.close()
        result = refresh(self.path, self.client, lambda _: png())
        self.assertEqual(result["errors"], 0)
        self.assertEqual(result["images"], 2)
        self.assertEqual(len(list((self.path.parent / "images").glob("*.webp"))), 1)
        self.assertEqual(list((self.path.parent / "images").glob("*.tmp")), [])

    def test_vk_errors_do_not_include_token(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=ValueError("secret-token")):
            with self.assertRaisesRegex(RuntimeError, "^VK community lookup failed$") as raised:
                VK("secret-token").groups(["42"])
        self.assertNotIn("secret-token", str(raised.exception))

    def test_old_event_schema_is_backfilled_without_change_feed(self):
        db = writer(self.path)
        db.execute("DELETE FROM metadata WHERE key = 'event_schema'")
        db.close()
        source = FakeSource()
        source.games[1] = game(vk_club="club99")
        sync(self.path, source, NOW)
        self.assertEqual(snapshot(self.path)["events"][0]["vk_group"], "99")


if __name__ == "__main__":
    unittest.main()
