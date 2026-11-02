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

# Exercise the normal suite with cloud encryption enabled, using ephemeral keys.
import atexit
import base64
import json
from pathlib import Path
import tempfile
from uuid import uuid4
_test_key_directory = tempfile.TemporaryDirectory(prefix='kvachat-test-key-')
atexit.register(_test_key_directory.cleanup)
_test_key_id = uuid4().hex
_test_key_file = Path(_test_key_directory.name) / 'keyring.json'
_test_key_file.write_text(json.dumps({'active':_test_key_id, 'keys':{_test_key_id:base64.b64encode(os.urandom(32)).decode()}}), encoding='utf-8')
os.environ['TESCORD_DATA_KEYRING_PATH'] = str(_test_key_file)
os.environ['TESCORD_DATA_ENCRYPTION_REQUIRED'] = 'true'

import asyncio
import pytest


@pytest.fixture(autouse=True)
def isolate_auth_email_delivery(monkeypatch):
    import app.main as main
    async def paused():
        await asyncio.Event().wait()
    monkeypatch.setattr(main, 'run_auth_mail', paused)
