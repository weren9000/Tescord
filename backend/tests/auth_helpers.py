"""Test mailbox reads the encrypted local outbox, never a production inbox."""
import json
import re
from sqlalchemy import select
from app.db.models import AuthMail
from app.db.session import SessionLocal
from app.services.auth_security import decrypt


def email_code(email):
    with SessionLocal() as db:
        for mail in db.scalars(select(AuthMail).where(AuthMail.delivered_at.is_(None)).order_by(AuthMail.available_at.desc()).limit(100)):
            payload = json.loads(decrypt(mail.payload))
            if payload['to'] == email and 'код:' in payload['body']:
                return re.search(r'код: (\d{6})', payload['body']).group(1)
    raise AssertionError('Verification message not queued')


def registration_grant(client, email):
    start = client.post('/api/auth/email/start', json={'email': email})
    assert start.status_code == 200
    verified = client.post('/api/auth/email/verify', json={
        'challenge_token': start.json()['challenge_token'], 'code': email_code(email)})
    assert verified.status_code == 200
    return verified.json()['registration_token']


def register_verified(client, payload):
    grant = registration_grant(client, payload['email'])
    return client.post('/api/auth/register', json={**payload, 'registration_token': grant})
