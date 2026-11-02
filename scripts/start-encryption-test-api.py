"""Disposable loopback API; requires local PostgreSQL audit@55439 and optional LiveKit@7895. No production settings are read."""
import os, sys, json, subprocess
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
import psycopg
import socket
from cryptography.fernet import Fernet

root = Path(__file__).resolve().parent.parent
(root/'.local').mkdir(exist_ok=True)
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1',8027)) == 0:
        raise SystemExit('Stop the previous local test API before creating a new fixture')
name = 'test_secret_e2e_' + uuid4().hex[:10]
os.environ.update(TESCORD_ENVIRONMENT='development', TESCORD_DEBUG='false', TESCORD_SEED_DEMO_DATA='false',
    TESCORD_RATE_LIMITS_ENABLED='false', TESCORD_REDIS_URL='', TESCORD_SECRET_KEY='local-encryption-tests-only-' + uuid4().hex,
    TESCORD_AUTH_ENCRYPTION_KEY=Fernet.generate_key().decode(), TESCORD_SMTP_HOST='127.0.0.1',
    TESCORD_SMTP_PORT='25259', TESCORD_SMTP_SECURITY='plain', TESCORD_SMTP_FROM='test@example.test',
    TESCORD_SMTP_USERNAME='', TESCORD_SMTP_PASSWORD='', TESCORD_LIVEKIT_URL='', TESCORD_LIVEKIT_API_KEY='',
    TESCORD_LIVEKIT_API_SECRET='', TESCORD_TURN_URLS='[]', TESCORD_TURN_SHARED_SECRET='',
    TESCORD_PUSH_VAPID_PUBLIC_KEY='', TESCORD_PUSH_VAPID_PRIVATE_KEY_PATH='', TESCORD_PUSH_VAPID_SUBJECT='',
    TESCORD_UPLOADS_DIR=str(root / '.local/secret-e2e-uploads'), PYTHONIOENCODING='utf-8',
    TESCORD_DATABASE_URL='postgresql+psycopg://audit@127.0.0.1:55439/'+name,
    TESCORD_CORS_ORIGINS='["http://127.0.0.1:4200","http://localhost:4200"]',
    TESCORD_DATA_KEYRING_PATH=str(root/'.local/secret-e2e-keyring.json'), TESCORD_DATA_ENCRYPTION_REQUIRED='true',
    TESCORD_SECRET_CHATS_ENABLED='true', TESCORD_MEDIA_ENCRYPTION_ENABLED='true')
os.environ.update(TESCORD_LIVEKIT_URL='ws://127.0.0.1:7895', TESCORD_LIVEKIT_INTERNAL_URL='http://127.0.0.1:7895', TESCORD_LIVEKIT_API_KEY='localtest', TESCORD_LIVEKIT_API_SECRET='isolated-local-livekit-test-secret')
with psycopg.connect('host=127.0.0.1 port=55439 user=audit dbname=postgres',autocommit=True) as connection:
    connection.execute('CREATE DATABASE '+name)
os.chdir(root/'backend');sys.path.insert(0,str(root/'backend'))
from app.encryption_admin import generate_keyring
keyfile=Path(os.environ['TESCORD_DATA_KEYRING_PATH'])
if not keyfile.exists():generate_keyring(keyfile)
subprocess.run([sys.executable,'-m','alembic','upgrade','head'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
from app.db.models import User, FriendRequest, FriendRequestStatus
from app.db.session import SessionLocal
from app.core.security import hash_password
with SessionLocal() as db:
    users=[]
    for label in ('Alice','Bob','Carol'):
        user=User(public_id=10000+len(users),username='Crypto '+label,email=label.lower()+'@secret-e2e.test',password_hash=hash_password('local-test-only-password'),email_verified_at=datetime.now(timezone.utc))
        db.add(user);db.flush();users.append(user)
    db.add(FriendRequest(requester_user_id=users[0].id,target_user_id=users[1].id,status=FriendRequestStatus.ACCEPTED))
    db.commit()
    (root/'.local/secret-e2e.json').write_text(json.dumps({'database':name,'users':[{'id':str(u.id),'email':u.email} for u in users]}),encoding='utf-8')
(root/'frontend/dist/frontend/browser/runtime-config.js').write_text('window.__TESCORD_RUNTIME_CONFIG__ = {apiBaseUrl:"http://127.0.0.1:8027",wsBaseUrl:"ws://127.0.0.1:8027"};',encoding='utf-8')
import uvicorn
uvicorn.run('app.main:app',host='127.0.0.1',port=8027,log_level='warning')
