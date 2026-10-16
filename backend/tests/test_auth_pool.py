from sqlalchemy import select
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.db.session import SessionLocal, engine
from app.main import app
from test_auth_workspace import register_regular_user, delete_user


def test_authentication_releases_pool_and_preserves_profile_writes():
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        sessions = []
        try:
            baseline = engine.pool.checkedout()
            # More requests waiting for handlers than the pool's 15 connections.
            for _ in range(20):
                db = SessionLocal()
                sessions.append(db)
                user = get_current_user(HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), db)
                assert user.email == payload['email']
            assert engine.pool.checkedout() <= baseline
            user.username = 'changed_pool_test'
            sessions[-1].commit()
            with SessionLocal() as verify:
                assert verify.scalar(select(User).where(User.email == payload['email'])).username == 'changed_pool_test'
        finally:
            for db in sessions:
                db.close()
            delete_user(payload['email'])
