"""Issuer/consumer contract tests without a chat database or app lifespan."""
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'backend'))
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import applications
from app.api.dependencies.auth import get_current_user
from app.db.session import get_db
from app.services.islands_grants import create_islands_grant
from islands.auth import verify_grant


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='islands-bridge-')
        self.key = Ed25519PrivateKey.generate()
        self.path = Path(self.directory.name) / 'test-key.pem'
        self.path.write_bytes(self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        self.user = SimpleNamespace(id=uuid4(), username='Аня')

    def tearDown(self):
        self.directory.cleanup()

    def test_issuer_and_consumer_use_same_contract_and_no_chat_claims(self):
        result = create_islands_grant(str(self.user.id), self.user.username, str(self.path))
        claims = verify_grant(result['grant'], self.key.public_key())
        self.assertEqual(claims['sub'], str(self.user.id))
        self.assertEqual(claims['nick'], 'Аня')
        self.assertEqual(set(claims), {'iss', 'aud', 'sub', 'nick', 'iat', 'exp', 'jti'})
        self.assertLessEqual(claims['exp']-int(time.time()), 60)

    def test_grants_require_feature_and_account_connection(self):
        app = FastAPI()
        app.include_router(applications.router, prefix='/api')
        app.dependency_overrides[get_current_user] = lambda: self.user
        enabled = False
        app.dependency_overrides[get_db] = lambda: SimpleNamespace(scalar=lambda statement: enabled)
        settings = SimpleNamespace(islands_enabled=False, islands_grant_private_key_path=str(self.path))
        with patch.object(applications, 'get_settings', return_value=settings), TestClient(app) as client:
            self.assertNotIn('islands', applications.application_catalog())
            self.assertEqual(client.post('/api/applications/islands/grant').status_code, 404)
            settings.islands_enabled = True
            self.assertIn('islands', applications.application_catalog())
            self.assertEqual(client.post('/api/applications/islands/grant').status_code, 403)
            enabled = True
            response = client.post('/api/applications/islands/grant')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'private, no-store')
            self.assertEqual(verify_grant(response.json()['grant'], self.key.public_key())['sub'], str(self.user.id))
            settings.islands_grant_private_key_path = str(self.path.with_name('missing.pem'))
            self.assertEqual(client.post('/api/applications/islands/grant').status_code, 503)


if __name__ == '__main__':
    unittest.main()
