import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from game_calendar.app import app
from game_calendar.store import snapshot
from game_calendar.sync import normalize, sync


NOW = datetime(2026, 10, 29, tzinfo=timezone.utc)


def game(event_id=1, **kwargs):
    return dict(id=event_id, name="Игра", begin="2026-11-01", time=3, sub_region_name="Урал",
                game_type_name="Полевая", status_name="Заявлена", **kwargs)


class FakeSource:
    def __init__(self):
        self.games = {1: game()}
        self.changes = []
        self.calls = []

    def listing(self, year):
        return {1}

    def changed(self, since):
        self.calls.append(since)
        return self.changes

    def game(self, event_id):
        value = self.games[event_id]
        if isinstance(value, Exception):
            raise value
        return value


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "calendar.sqlite3"
        self.source = FakeSource()

    def tearDown(self):
        self.temp.cleanup()

    def test_first_run_and_incremental_sync_preserve_unchanged_events(self):
        sync(self.path, self.source, NOW)
        self.source.games[2] = game(2)
        self.source.changes = [{"id": 2, "deleted_flag": "0"}]
        sync(self.path, self.source, NOW + timedelta(days=1))
        data = snapshot(self.path)
        self.assertEqual([e['id'] for e in data['events']], [1, 2])
        self.assertEqual(data['events'][0]['end_date'], '2026-11-03')
        self.assertEqual(self.source.calls[-1], int(NOW.timestamp()) - 300)

    def test_partial_failure_rolls_back_data_and_cursor(self):
        sync(self.path, self.source, NOW)
        self.source.games[1] = {**game(), 'name': 'Changed'}
        self.source.games[2] = OSError('source unavailable')
        self.source.changes = [{'id': 1}, {'id': 2}]
        with self.assertRaises(OSError):
            sync(self.path, self.source, NOW + timedelta(days=1))
        data = snapshot(self.path)
        self.assertEqual(data['events'][0]['name'], 'Игра')
        self.assertEqual(data['updated_at'], NOW.isoformat())
        self.assertTrue(data['last_attempt_failed'])
        self.source.games[2] = game(2)
        sync(self.path, self.source, NOW + timedelta(days=2))
        self.assertEqual(self.source.calls[-1], int(NOW.timestamp()) - 300)
        self.assertFalse(snapshot(self.path)['last_attempt_failed'])

    def test_deleted_and_private_records_are_removed(self):
        sync(self.path, self.source, NOW)
        self.source.changes = [{'id': 1, 'deleted_flag': '1'}]
        sync(self.path, self.source, NOW + timedelta(days=1))
        self.assertEqual(snapshot(self.path)['events'], [])
        self.assertIsNone(normalize({'id': '1', 'access-denied': '1'}, 1))

    def test_merged_game_replaces_old_identity(self):
        sync(self.path, self.source, NOW)
        self.source.games[1] = {'id': 1, 'redirect_id': 2}
        self.source.games[2] = game(2)
        self.source.changes = [{'id': 1}]
        sync(self.path, self.source, NOW + timedelta(days=1))
        self.assertEqual([e['id'] for e in snapshot(self.path)['events']], [2])

    def test_unsafe_links_and_html_are_not_rendered_as_code(self):
        value = normalize(game(uri='javascript:alert(1)', comment='<b>Текст</b>', email='private@example.test'), 1)
        self.assertIsNone(value['website'])
        self.assertEqual(value['description'], 'Текст')
        self.assertNotIn('email', value)

    def test_unknown_date_is_not_invented(self):
        value = normalize({**game(), 'begin': None, 'time': None}, 1)
        self.assertIsNone(value['start_date'])
        self.assertIsNone(value['end_date'])

    def test_api_without_sync_and_read_only_routes(self):
        with patch.dict(os.environ, {'KVA_CALENDAR_DB': str(self.path)}):
            client = TestClient(app)
            response = client.get('/plugins/game-calendar/api/events')
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()['ready'])
            self.assertIn("object-src 'none'", response.headers['content-security-policy'])
            self.assertEqual(client.post('/plugins/game-calendar/api/events').status_code, 405)
            self.assertEqual(client.get('/plugins/game-calendar/').status_code, 200)
            self.assertEqual(client.get('/plugins/game-calendar/manifest.json').json()['permissions'], [])

    def test_readers_see_previous_snapshot_during_sync(self):
        sync(self.path, self.source, NOW)
        original = self.source.game
        def observe(event_id):
            self.assertEqual(snapshot(self.path)['events'][0]['name'], 'Игра')
            return {**original(event_id), 'name': 'New'}
        self.source.game = observe
        self.source.changes = [{'id': 1}]
        sync(self.path, self.source, NOW + timedelta(days=1))
        self.assertEqual(snapshot(self.path)['events'][0]['name'], 'New')


if __name__ == '__main__':
    unittest.main()
