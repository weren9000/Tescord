import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID, uuid4

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.models import AuthChallenge, AuthMail, AuthSession, PushSubscription, RecoveryCode, User
from app.db.session import SessionLocal
from app.main import app
from app.services import auth_security as security
from app.services import auth_mail
from auth_helpers import email_code, registration_grant, register_verified

PASSWORD = 'Local-test-password-123'


@pytest.fixture
def client():
    with TestClient(app) as value:
        yield value


def payload():
    suffix = uuid4().hex[:12]
    return {'email': f'auth-{suffix}@example.test', 'nick': 'auth-' + suffix,
            'password': PASSWORD, 'password_confirmation': PASSWORD}


def account(client):
    data = payload()
    registered = register_verified(client, data)
    assert registered.status_code == 201
    return data, registered.json(), {'Authorization': 'Bearer ' + registered.json()['access_token']}


def enable(client, headers):
    setup = client.post('/api/auth/totp/setup', headers=headers, json={'password': PASSWORD})
    assert setup.status_code == 200
    code = pyotp.TOTP(setup.json()['secret']).now()
    confirmed = client.post('/api/auth/totp/confirm', headers=headers, json={
        'challenge_token': setup.json()['challenge_token'], 'code': code})
    assert confirmed.status_code == 200
    return setup.json(), confirmed.json()['recovery_codes']


def test_registration_requires_email_ownership_and_grant_is_one_use(client):
    data = payload()
    assert client.post('/api/auth/register', json=data).status_code == 426
    start = client.post('/api/auth/email/start', json={'email': data['email']})
    assert start.status_code == 200
    token = start.json()['challenge_token']
    with SessionLocal() as db:
        assert db.scalar(select(User.id).where(User.email == data['email'])) is None
    assert client.get('/api/me', headers={'Authorization': 'Bearer ' + token}).status_code == 401
    code = email_code(data['email'])
    verified = client.post('/api/auth/email/verify', json={'challenge_token': token, 'code': code})
    grant = verified.json()['registration_token']
    assert client.post('/api/auth/email/verify', json={'challenge_token': token, 'code': code}).status_code == 400
    assert client.get('/api/me', headers={'Authorization': 'Bearer ' + grant}).status_code == 401
    wrong = {**data, 'email': 'other@example.test', 'registration_token': grant}
    assert client.post('/api/auth/register', json=wrong).status_code == 400
    assert client.post('/api/auth/register', json={**data, 'registration_token': grant}).status_code == 201
    assert client.post('/api/auth/register', json={**data, 'registration_token': grant}).status_code == 400


def test_email_attempt_limit_expiry_and_resend(client):
    data = payload()
    start = client.post('/api/auth/email/start', json={'email': data['email']}).json()
    token = start['challenge_token']
    old_code = email_code(data['email'])
    assert client.post('/api/auth/email/start', json={'email': data['email'], 'challenge_token': token}).status_code == 429
    with SessionLocal() as db:
        challenge = db.scalar(select(AuthChallenge).where(AuthChallenge.token_hash == security.digest(token)))
        challenge.sent_at -= timedelta(seconds=61)
        challenge.attempts = 3
        db.commit()
    assert client.post('/api/auth/email/start', json={'email': data['email'], 'challenge_token': token}).status_code == 200
    with SessionLocal() as db:
        challenge = db.scalar(select(AuthChallenge).where(AuthChallenge.token_hash == security.digest(token)))
        assert challenge.attempts == 3
    # Ensure the old code no longer verifies; random equality is excluded explicitly.
    new_code = email_code(data['email'])
    if new_code != old_code:
        assert client.post('/api/auth/email/verify', json={'challenge_token': token, 'code': old_code}).status_code == 400
    for _ in range(5):
        assert client.post('/api/auth/email/verify', json={'challenge_token': token, 'code': 'wrong'}).status_code == 400
    assert client.post('/api/auth/email/verify', json={'challenge_token': token, 'code': new_code}).status_code == 400
    data = payload()
    start = client.post('/api/auth/email/start', json={'email': data['email']}).json()
    with SessionLocal() as db:
        row = db.scalar(select(AuthChallenge).where(AuthChallenge.token_hash == security.digest(start['challenge_token'])))
        row.expires_at = security.now() - timedelta(seconds=1)
        db.commit()
    assert client.post('/api/auth/email/verify', json={'challenge_token': start['challenge_token'], 'code': email_code(data['email'])}).status_code == 400


def test_totp_login_recovery_and_session_revocation(client):
    data, session, headers = account(client)
    second = client.post('/api/auth/login', json=data).json()
    settings = get_settings()
    old_sid = UUID(decode_access_token(second['access_token'], settings.secret_key)['sid'])
    with SessionLocal() as db:
        db.add(PushSubscription(user_id=UUID(session['user']['id']), session_id=old_sid,
            endpoint='https://push.example.test/' + uuid4().hex, p256dh='test', auth='test'))
        db.commit()
    setup, codes = enable(client, headers)
    assert len(codes) == 10 and len(set(codes)) == 10
    assert client.get('/api/me', headers={'Authorization': 'Bearer ' + second['access_token']}).status_code == 401
    assert client.get('/api/me', headers=headers).status_code == 200
    with SessionLocal() as db:
        user = db.get(User, UUID(session['user']['id']))
        assert user.totp_secret != setup['secret']
        assert db.scalar(select(PushSubscription.id).where(PushSubscription.session_id == old_sid)) is None
        assert all(row.code_hash not in codes for row in db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user.id)))
    assert client.post('/api/auth/login', json=data).status_code == 426
    login = client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()
    assert 'access_token' not in login
    assert client.get('/api/me', headers={'Authorization': 'Bearer ' + login['challenge_token']}).status_code == 401
    with client.websocket_connect('/api/events/ws') as ws:
        ws.send_json({'type': 'authenticate', 'token': login['challenge_token']})
        with pytest.raises(WebSocketDisconnect): ws.receive_json()
    verified = client.post('/api/auth/login/verify', json={'challenge_token': login['challenge_token'], 'code': codes[0]})
    assert verified.status_code == 200
    assert client.post('/api/auth/login/verify', json={'challenge_token': login['challenge_token'], 'code': codes[1]}).status_code == 400
    another = client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()
    assert client.post('/api/auth/login/verify', json={'challenge_token': another['challenge_token'], 'code': codes[0]}).status_code == 400
    disable = client.post('/api/auth/totp/disable', headers=headers, json={'password': PASSWORD, 'code': codes[1]})
    assert disable.status_code == 204
    assert client.post('/api/auth/login', json=data).status_code == 200
    assert client.post('/api/auth/login/verify', json={'challenge_token': another['challenge_token'], 'code': codes[2]}).status_code == 400


def test_totp_code_cannot_be_replayed_and_challenges_expire(client, monkeypatch):
    data, _, headers = account(client)
    setup, _ = enable(client, headers)
    future = security.now() + timedelta(seconds=31)
    monkeypatch.setattr(security, 'now', lambda: future)
    login = client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()
    value = pyotp.TOTP(setup['secret']).at(future)
    assert client.post('/api/auth/login/verify', json={'challenge_token': login['challenge_token'], 'code': value}).status_code == 200
    login2 = client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()
    assert client.post('/api/auth/login/verify', json={'challenge_token': login2['challenge_token'], 'code': value}).status_code == 400
    monkeypatch.setattr(security, 'now', lambda: future + timedelta(minutes=6))
    assert client.post('/api/auth/login/verify', json={'challenge_token': login2['challenge_token'], 'code': value}).status_code == 400


def test_setup_bound_to_user_session_and_password(client):
    data, _, headers = account(client)
    assert client.post('/api/auth/totp/setup', headers=headers, json={'password': 'wrong'}).status_code == 400
    setup = client.post('/api/auth/totp/setup', headers=headers, json={'password': PASSWORD}).json()
    second = client.post('/api/auth/login', json=data).json()
    claim = {'challenge_token': setup['challenge_token'], 'code': pyotp.TOTP(setup['secret']).now()}
    assert client.post('/api/auth/totp/confirm', headers={'Authorization': 'Bearer ' + second['access_token']}, json=claim).status_code == 400
    _, _, outsider = account(client)
    assert client.post('/api/auth/totp/confirm', headers=outsider, json=claim).status_code == 400
    assert client.post('/api/auth/totp/confirm', headers=headers, json=claim).status_code == 200


def test_concurrent_recovery_consumption_and_registration(client):
    data, _, headers = account(client)
    _, codes = enable(client, headers)
    challenges = [client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()['challenge_token'] for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda token: client.post('/api/auth/login/verify', json={'challenge_token': token, 'code': codes[0]}).status_code, challenges))
    assert sorted(results) == [200, 400]
    data = payload()
    grant = registration_grant(client, data['email'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post('/api/auth/register', json={**data, 'registration_token': grant}).status_code, range(2)))
    assert sorted(results) == [201, 400]


def test_recovery_rotation_invalidates_old_codes_and_logout_invalidates_challenges(client):
    data, _, headers = account(client)
    _, codes = enable(client, headers)
    rotated = client.post('/api/auth/totp/recovery-codes', headers=headers, json={'password': PASSWORD, 'code': codes[0]})
    assert rotated.status_code == 200
    login = client.post('/api/auth/login', json={**data, 'auth_protocol': 2}).json()
    assert client.post('/api/auth/login/verify', json={'challenge_token': login['challenge_token'], 'code': codes[1]}).status_code == 400
    assert client.post('/api/auth/logout-all', headers=headers).status_code == 204
    assert client.post('/api/auth/login/verify', json={'challenge_token': login['challenge_token'], 'code': rotated.json()['recovery_codes'][0]}).status_code == 400


def test_unconfigured_email_fails_closed_without_breaking_existing_login(client, monkeypatch):
    data, _, _ = account(client)
    monkeypatch.setattr(get_settings(), 'smtp_host', None)
    assert client.post('/api/auth/email/start', json={'email': payload()['email']}).status_code == 503
    assert client.post('/api/auth/login', json=data).status_code == 200


def test_mail_retry_keeps_encrypted_payload_and_erases_after_delivery(client, monkeypatch):
    with SessionLocal() as db:
        auth_mail.queue_mail(db, 'retry@example.test', 'test', 'private test content')
        db.commit()
    def fail(_): raise OSError('test delivery failure')
    monkeypatch.setattr(auth_mail, 'send_mail', fail)
    # Mark unrelated queued mail delivered so this test isolates its own message.
    with SessionLocal() as db:
        rows = list(db.scalars(select(AuthMail).where(AuthMail.delivered_at.is_(None))))
        target = next(row for row in rows if json.loads(security.decrypt(row.payload))['to'] == 'retry@example.test')
        target_id = target.id
        for row in rows:
            if row.id != target_id: row.delivered_at = security.now()
        db.commit()
    auth_mail.dispatch_mail()
    with SessionLocal() as db:
        row = db.get(AuthMail, target_id)
        assert row.attempts == 1 and row.delivered_at is None
        assert 'private test content' not in row.payload
        row.available_at = security.now() - timedelta(seconds=1)
        db.commit()
    captured = []
    monkeypatch.setattr(auth_mail, 'send_mail', captured.append)
    auth_mail.dispatch_mail()
    assert len(captured) == 1 and captured[0]['body'] == 'private test content'
    with SessionLocal() as db:
        row = db.get(AuthMail, target_id)
        assert row.delivered_at and row.payload == ''


def test_smtp_transport_delivers_to_local_mailbox(monkeypatch):
    import socketserver
    import threading
    from email import policy
    from email.parser import BytesParser
    received = []
    class SMTPHandler(socketserver.StreamRequestHandler):
        def handle(self):
            self.wfile.write(b'220 local test mailbox\r\n')
            while line := self.rfile.readline():
                command = line.split(b' ', 1)[0].strip().upper()
                if command == b'DATA':
                    self.wfile.write(b'354 send data\r\n')
                    body = b''
                    while (part := self.rfile.readline()) not in (b'.\r\n', b''):
                        body += part
                    received.append(BytesParser(policy=policy.default).parsebytes(body))
                    self.wfile.write(b'250 accepted\r\n')
                elif command == b'QUIT':
                    self.wfile.write(b'221 bye\r\n')
                    break
                else:
                    self.wfile.write(b'250 OK\r\n')
    with socketserver.TCPServer(('127.0.0.1', 0), SMTPHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        monkeypatch.setattr(get_settings(), 'smtp_port', server.server_address[1])
        try:
            auth_mail.send_mail({'to': 'recipient@example.test', 'subject': 'Квачат: тест', 'body': 'Проверка доставки'})
            assert len(received) == 1
            assert received[0]['To'] == 'recipient@example.test'
            assert received[0]['Subject'] == 'Квачат: тест'
            assert 'Проверка доставки' in received[0].get_content()
        finally:
            server.shutdown()
            thread.join(timeout=5)


def test_legacy_migration_preserves_existing_sessions():
    import os
    from pathlib import Path
    import subprocess
    import sys
    import psycopg
    from sqlalchemy.engine import make_url
    settings = get_settings()
    url = make_url(settings.database_url).set(drivername='postgresql')
    name = 'test_auth_migration_' + uuid4().hex[:10]
    admin_url = url.set(database='postgres').render_as_string(hide_password=False)
    with psycopg.connect(admin_url, autocommit=True) as connection:
        connection.execute('CREATE DATABASE ' + name)
    test_url = url.set(database=name).render_as_string(hide_password=False)
    env = {**os.environ, 'TESCORD_DATABASE_URL': str(url.set(drivername='postgresql+psycopg', database=name))}
    backend = Path(__file__).resolve().parents[1]
    def migrate(target):
        subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', target], cwd=backend, env=env,
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    migrate('20261030_0055')
    uid, sid = uuid4(), uuid4()
    with psycopg.connect(test_url) as connection:
        connection.execute('INSERT INTO users (id,email,username,public_id,password_hash,is_admin) VALUES (%s,%s,%s,%s,%s,false)',
            (uid, 'legacy@example.test', 'legacy', 12345, 'unchanged-hash'))
        connection.execute("INSERT INTO auth_sessions (id,user_id,expires_at) VALUES (%s,%s,now()+interval '1 day')", (sid, uid))
    migrate('head')
    with psycopg.connect(test_url) as connection:
        verified, source, secret, password = connection.execute('SELECT email_verified_at,email_verification_source,totp_secret,password_hash FROM users WHERE id=%s', (uid,)).fetchone()
        assert verified is not None and source == 'legacy' and secret is None and password == 'unchanged-hash'
        assert connection.execute('SELECT revoked_at IS NULL FROM auth_sessions WHERE id=%s', (sid,)).fetchone()[0]
        connection.execute('INSERT INTO users (id,email,username,public_id,password_hash,is_admin) VALUES (%s,%s,%s,%s,%s,false)',
            (uuid4(), 'new-unverified@example.test', 'new-unverified', 12346, 'test'))
        assert connection.execute("SELECT email_verified_at IS NULL FROM users WHERE email='new-unverified@example.test'").fetchone()[0]
