"""Integration tests must use an explicitly selected, local disposable database."""
import os
from urllib.parse import urlsplit

database = urlsplit(os.environ.get('TESCORD_DATABASE_URL', ''))
if database.hostname not in {'localhost', '127.0.0.1'} or not database.path.rsplit('/', 1)[-1].startswith(('test', 'kva_fix')):
    raise RuntimeError('Set TESCORD_DATABASE_URL to a local test* or kva_fix* database; never use production data')
os.environ['TESCORD_ENVIRONMENT'] = 'development'
os.environ['TESCORD_SEED_DEMO_DATA'] = 'true'
os.environ['TESCORD_DEMO_PASSWORD'] = 'testing-only-not-for-production'
os.environ['TESCORD_DEMO_SERVER_NAME'] = 'Altgramm'
os.environ['TESCORD_DEBUG'] = 'false'
os.environ['TESCORD_RATE_LIMITS_ENABLED'] = 'false'
os.environ['TESCORD_REDIS_URL'] = ''
os.environ['TESCORD_SMTP_HOST'] = '127.0.0.1'
os.environ['TESCORD_SMTP_PORT'] = '25259'
os.environ['TESCORD_SMTP_SECURITY'] = 'plain'
os.environ['TESCORD_SMTP_FROM'] = 'test@example.test'
os.environ['TESCORD_SMTP_USERNAME'] = ''
os.environ['TESCORD_SMTP_PASSWORD'] = ''
from cryptography.fernet import Fernet
os.environ.setdefault('TESCORD_AUTH_ENCRYPTION_KEY', Fernet.generate_key().decode())

import asyncio
import pytest


@pytest.fixture(autouse=True)
def isolate_auth_email_delivery(monkeypatch):
    import app.main as main
    async def paused():
        await asyncio.Event().wait()
    monkeypatch.setattr(main, 'run_auth_mail', paused)
