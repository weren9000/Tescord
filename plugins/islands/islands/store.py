"""Own SQLite database; atomic room transitions and idempotent commands.

State, membership and receipt are committed in the same transaction. Receipts
contain only a command digest/version, never a cached private player response.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import time
from uuid import UUID, uuid4

from . import engine as e


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def identifier(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


class Store:
    def __init__(self, path, clock=time.time):
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
                    owner TEXT NOT NULL, create_request TEXT NOT NULL,
                    state TEXT NOT NULL, version INTEGER NOT NULL,
                    updated REAL NOT NULL, status TEXT NOT NULL,
                    UNIQUE(owner, create_request)
                );
                CREATE TABLE IF NOT EXISTS members (
                    room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    uid TEXT NOT NULL, PRIMARY KEY(room, uid)
                );
                CREATE INDEX IF NOT EXISTS members_uid ON members(uid);
                CREATE TABLE IF NOT EXISTS receipts (
                    room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    uid TEXT NOT NULL, request TEXT NOT NULL, digest TEXT NOT NULL,
                    version INTEGER NOT NULL, PRIMARY KEY(room, uid, request)
                );
                CREATE TABLE IF NOT EXISTS events (
                    room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    version INTEGER NOT NULL, uid TEXT NOT NULL,
                    action TEXT NOT NULL, at REAL NOT NULL,
                    PRIMARY KEY(room, version)
                );
                CREATE TABLE IF NOT EXISTS grants (jti TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, uid TEXT NOT NULL,
                    nick TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
            ''')

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def exchange(self, claims):
        now = self.clock()
        token = secrets.token_urlsafe(32)
        # Grant lifetime + session lifetime bounds revocation delay to 90 s.
        expires = min(now + 90, claims['iat'] + 90)
        with self.connect(True) as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (now,))
            db.execute('DELETE FROM grants WHERE expires <= ?', (now,))
            e.require(claims['exp'] > now, 'Разрешение истекло.', 'unauthorized')
            try:
                db.execute('INSERT INTO grants VALUES (?, ?)', (claims['jti'], claims['exp']))
            except sqlite3.IntegrityError:
                raise e.RuleError('Разрешение уже использовано.', 'unauthorized') from None
            db.execute('INSERT INTO sessions VALUES (?, ?, ?, ?)',
                       (hashlib.sha256(token.encode()).hexdigest(), claims['sub'], claims['nick'], expires))
        return {'token': token, 'expires_at': expires, 'user': {'id': claims['sub'], 'nick': claims['nick']}}

    def authenticate(self, token):
        e.require(isinstance(token, str) and 32 <= len(token) <= 128, 'Требуется вход через Квачат.', 'unauthorized')
        with self.connect() as db:
            row = db.execute('SELECT uid, nick, expires FROM sessions WHERE digest=?',
                             (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        e.require(row is not None and row['expires'] > self.clock(), 'Сессия игры истекла. Откройте игру через Квачат.', 'unauthorized')
        return dict(row)

    def revoke(self, token):
        with self.connect(True) as db:
            db.execute('DELETE FROM sessions WHERE digest=?', (hashlib.sha256(token.encode()).hexdigest(),))

    def _room(self, db, room_id, uid):
        row = db.execute('SELECT rooms.* FROM rooms JOIN members ON members.room=rooms.id WHERE rooms.id=? AND members.uid=?', (room_id, uid)).fetchone()
        e.require(row is not None, 'Комната недоступна.', 'not_found')
        return row

    def _view(self, row, uid):
        return {'id': row['id'], 'code': row['code'], 'version': row['version'],
                'updated_at': row['updated'], 'state': e.player_view(json.loads(row['state']), uid)}

    def get(self, room_id, uid):
        with self.connect() as db:
            return self._view(self._room(db, room_id, uid), uid)

    def list_rooms(self, uid):
        with self.connect() as db:
            rows = db.execute('SELECT rooms.* FROM rooms JOIN members ON members.room=rooms.id WHERE members.uid=? ORDER BY updated DESC LIMIT 40', (uid,)).fetchall()
        return [{'id': row['id'], 'code': row['code'], 'status': row['status'],
                 'updated_at': row['updated'], 'players': [p['nick'] for p in json.loads(row['state'])['players']]} for row in rows]

    def create(self, user, request_id):
        e.require(identifier(request_id), 'Некорректный идентификатор запроса.')
        uid = user['uid']
        with self.connect(True) as db:
            existing = db.execute('SELECT * FROM rooms WHERE owner=? AND create_request=?', (uid, request_id)).fetchone()
            if existing:
                return self._view(self._room(db, existing['id'], uid), uid)
            self._check_room_limit(db, uid)
            room_id, code = str(uuid4()), secrets.token_hex(6).upper()
            state = e.new_lobby(uid, user['nick'])
            db.execute('INSERT INTO rooms VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
                       (room_id, code, uid, request_id, canonical(state), self.clock(), 'lobby'))
            db.execute('INSERT INTO members VALUES (?, ?)', (room_id, uid))
            return self._view(self._room(db, room_id, uid), uid)

    def _check_room_limit(self, db, uid):
        count = db.execute("SELECT COUNT(*) FROM members JOIN rooms ON rooms.id=members.room WHERE uid=? AND status IN ('lobby','playing')", (uid,)).fetchone()[0]
        e.require(count < 5, 'У вас уже пять незавершённых партий. Сначала завершите одну из них.', 'limit')

    def _save(self, db, row, state, uid, action):
        version = row['version'] + 1
        db.execute('UPDATE rooms SET state=?, version=?, updated=?, status=? WHERE id=?',
                   (canonical(state), version, self.clock(), state['status'], row['id']))
        db.execute('INSERT INTO events VALUES (?, ?, ?, ?, ?)', (row['id'], version, uid, action, self.clock()))
        return version

    def join(self, code, user):
        uid = user['uid']
        with self.connect(True) as db:
            row = db.execute('SELECT * FROM rooms WHERE code=?', (code,)).fetchone()
            e.require(row is not None, 'Комната недоступна.', 'not_found')
            state = json.loads(row['state'])
            if any(p['id'] == uid for p in state['players']):
                return self._view(row, uid)
            e.require(state['status'] == 'lobby' and len(state['players']) < 4, 'Комната недоступна.', 'not_found')
            self._check_room_limit(db, uid)
            color = next(c for c in e.COLORS if all(p['color'] != c for p in state['players']))
            state['players'].append(e.new_player(uid, user['nick'], color))
            # A changed lobby requires everyone to confirm readiness again.
            for p in state['players']:
                p['ready'] = False
            db.execute('INSERT INTO members VALUES (?, ?)', (row['id'], uid))
            self._save(db, row, state, uid, 'join')
            return self._view(self._room(db, row['id'], uid), uid)

    def command(self, room_id, user, request_id, version, command):
        e.require(identifier(request_id) and type(version) is int and version >= 0, 'Некорректный запрос.')
        uid = user['uid']
        digest = hashlib.sha256(canonical({'version': version, 'command': command}).encode()).hexdigest()
        with self.connect(True) as db:
            receipt = db.execute('SELECT * FROM receipts WHERE room=? AND uid=? AND request=?', (room_id, uid, request_id)).fetchone()
            if receipt:
                e.require(receipt['digest'] == digest, 'Идентификатор уже использован для другого действия.', 'conflict')
                if command.get('type') == 'leave':
                    return {'left': True}
                row = self._room(db, room_id, uid)
                return {**self._view(row, uid), 'replayed': True}
            row = self._room(db, room_id, uid)
            e.require(row['version'] == version, 'Партия изменилась. Обновите поле и повторите действие.', 'conflict')
            e.require(version < 20000 or command['type'] in ('abandon_vote', 'leave'),
                      'Достигнут предел действий. Можно завершить партию голосованием.', 'limit')
            original = json.loads(row['state'])
            if command.get('type') == 'leave':
                e.require(original['status'] == 'lobby', 'Начатую партию можно завершить общим голосованием.')
                original['players'] = [p for p in original['players'] if p['id'] != uid]
                db.execute('DELETE FROM members WHERE room=? AND uid=?', (room_id, uid))
                if original['players']:
                    if original['host'] == uid:
                        original['host'] = original['players'][0]['id']
                        original['active'] = original['host']
                    for p in original['players']:
                        p['ready'] = False
                else:
                    original['status'] = 'abandoned'
                next_version = self._save(db, row, original, uid, 'leave')
                db.execute('INSERT INTO receipts VALUES (?, ?, ?, ?, ?)', (room_id, uid, request_id, digest, next_version))
                # No private data returned to a former member.
                return {'left': True}
            state = e.apply_command(original, uid, command)
            next_version = self._save(db, row, state, uid, command['type'])
            db.execute('INSERT INTO receipts VALUES (?, ?, ?, ?, ?)', (room_id, uid, request_id, digest, next_version))
            return {**self._view(self._room(db, room_id, uid), uid), 'replayed': False}

    def prune(self, days=30):
        """Explicit maintenance: finished rooms only; active parties are retained."""
        e.require(type(days) is int and days >= 7, 'Срок хранения должен быть не меньше семи дней.')
        with self.connect(True) as db:
            return db.execute("DELETE FROM rooms WHERE status IN ('finished','abandoned') AND updated<?", (self.clock() - days*86400,)).rowcount
