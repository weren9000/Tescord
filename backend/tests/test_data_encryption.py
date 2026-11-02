import base64
import io
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import get_settings
from app.services import data_encryption as crypto
from app.services.encrypted_files import CHUNK, HEADER_SIZE, StoredReader, StoredFileResponse, write_file, FileTooLarge


@pytest.fixture
def ring(tmp_path, monkeypatch):
    path = tmp_path / 'test-keyring.json'
    raw = json.loads(Path(get_settings().data_keyring_path).read_text(encoding='utf-8'))
    path.write_text(json.dumps(raw), encoding='utf-8')
    monkeypatch.setattr(get_settings(), 'data_keyring_path', str(path))
    monkeypatch.setattr(get_settings(), 'data_encryption_required', True)
    return path, raw


def test_message_context_tampering_rotation_and_missing_keys(ring, monkeypatch):
    blob = crypto.seal('Секретный текст'.encode(), 'messages/id/content')
    assert 'Секретный текст'.encode() not in blob
    assert crypto.unseal(blob, 'messages/id/content').decode() == 'Секретный текст'
    for damaged, context in [(blob, 'messages/other/content'), (blob[:-1], 'messages/id/content'),
                              (blob[:-1]+bytes([blob[-1]^1]), 'messages/id/content')]:
        with pytest.raises(crypto.EncryptionUnavailable):
            crypto.unseal(damaged, context)
    path, raw = ring
    raw['active'] = uuid4().hex
    raw['keys'][raw['active']] = base64.b64encode(os.urandom(32)).decode()
    path.write_text(json.dumps(raw), encoding='utf-8')
    assert crypto.unseal(blob, 'messages/id/content')
    assert crypto.seal(b'new', 'messages/id/content')[4:20].hex() == raw['active']
    monkeypatch.setattr(get_settings(), 'data_keyring_path', None)
    with pytest.raises(crypto.EncryptionUnavailable):
        crypto.seal(b'no plaintext fallback', 'x')


@pytest.mark.parametrize('size', [0, 1, CHUNK-1, CHUNK, CHUNK+17, 3*CHUNK+9])
def test_file_roundtrip_seek_and_container_integrity(tmp_path, ring, size):
    data = os.urandom(size)
    path = tmp_path / 'file.kvaenc'
    written, _ = write_file(io.BytesIO(data), path, max_bytes=size)
    assert written == size
    with StoredReader(path) as reader:
        assert reader.read() == data
        reader.seek(max(0, size-15))
        assert reader.read(10) == data[max(0, size-15):max(0, size-15)+10]
    original = path.read_bytes()
    for broken in [original[:-1], original+b'x', b'plaintext']:
        path.write_bytes(broken)
        with pytest.raises(crypto.EncryptionUnavailable):
            StoredReader(path)
    path.write_bytes(original)
    other = tmp_path / 'other.kvaenc'
    other.write_bytes(original)
    with pytest.raises(crypto.EncryptionUnavailable):
        StoredReader(other)
    if size:
        corrupted = bytearray(original)
        corrupted[HEADER_SIZE] ^= 1
        path.write_bytes(corrupted)
        with StoredReader(path) as reader, pytest.raises(crypto.EncryptionUnavailable):
            reader.read(1)


def test_limits_short_reads_ranges_head_and_preview(tmp_path, ring):
    from PIL import Image
    from app.services.attachment_previews import ensure_preview
    class ShortReads(io.BytesIO):
        def read(self, n=-1):
            return super().read(min(37, n) if n >= 0 else 37)
    data = b'0123456789' * 120_000
    path = tmp_path / 'test.kvaenc'
    write_file(ShortReads(data), path, max_bytes=len(data))
    app = FastAPI()
    @app.api_route('/file', methods=['GET', 'HEAD'])
    def download():
        return StoredFileResponse(path, media_type='application/octet-stream', filename='test.bin')
    with TestClient(app) as client:
        response = client.get('/file')
        assert response.content == data
        assert int(response.headers['content-length']) == len(data)
        for range_value, expected in [('bytes=0-9', data[:10]), ('bytes=-13', data[-13:]),
                                       (f'bytes={CHUNK-3}-{CHUNK+3}', data[CHUNK-3:CHUNK+4])]:
            response = client.get('/file', headers={'Range': range_value})
            assert response.status_code == 206 and response.content == expected
        for invalid in ['bytes=9999999-', 'bytes=-0', 'bytes=2-1', 'bytes=0-1,4-5']:
            assert client.get('/file', headers={'Range': invalid}).status_code == 416
        response = client.head('/file')
        assert response.content == b'' and int(response.headers['content-length']) == len(data)
    with pytest.raises(FileTooLarge):
        write_file(io.BytesIO(data), tmp_path / 'too-large.kvaenc', max_bytes=1)
    assert not list(tmp_path.glob('*.part'))
    image = io.BytesIO()
    Image.new('RGB', (800, 400), 'red').save(image, 'PNG')
    image.seek(0)
    source = tmp_path / 'photo.png.kvaenc'
    write_file(image, source, max_bytes=100_000)
    preview = ensure_preview(source)
    assert preview.name.endswith('.kvaenc')
    assert not preview.read_bytes().startswith(b'RIFF')
    with StoredReader(preview) as reader, Image.open(reader) as result:
        assert result.size == (640, 320)


def test_encrypted_message_api_search_edits_and_upload(tmp_path, ring, monkeypatch):
    from app.main import app
    from app.db.models import Attachment, Message
    from app.db.session import SessionLocal
    from app.services.attachment_storage import resolve_attachment_path
    from test_auth_workspace import register_regular_user, delete_user, delete_server
    monkeypatch.setattr(get_settings(), 'uploads_dir', str(tmp_path / 'uploads'))
    with TestClient(app) as client:
        token, user = register_regular_user(client)
        headers = {'Authorization': 'Bearer '+token}
        group = client.post('/api/conversations/group', headers=headers, json={'name':'Encrypted test', 'member_user_ids':[]}).json()
        channel = group['primary_channel_id']
        try:
            response = client.post(f'/api/channels/{channel}/messages', headers=headers,
                data={'content':'Привет шифрование 100%_тест'}, files={'files':('file.txt', b'private attachment', 'text/plain')})
            assert response.status_code == 201, response.text
            message = response.json()
            mid = UUID(message['id'])
            aid = UUID(message['attachments'][0]['id'])
            with SessionLocal() as db:
                stored = db.execute(text('SELECT content, encrypted_content, search_tokens FROM messages WHERE id=:id'), {'id':mid}).one()
                assert stored.content == '' and stored.encrypted_content
                assert b'100%' not in stored.encrypted_content
                assert all('тест' not in item for item in stored.search_tokens)
                attachment = db.get(Attachment, aid)
                assert resolve_attachment_path(attachment.storage_path).read_bytes() != b'private attachment'
            for query in ['ШИФРОВАНИЕ', 'ивет', '100%_', 'т']:
                found = client.get(f'/api/channels/{channel}/messages/search', headers=headers, params={'query':query})
                assert found.status_code == 200 and any(row['id'] == str(mid) for row in found.json()), found.text
            downloaded = client.get(f'/api/attachments/{aid}', headers=headers)
            assert downloaded.status_code == 200 and downloaded.content == b'private attachment', downloaded.text
            edited = client.patch(f'/api/messages/{mid}', headers=headers, json={'content':'Обновлённый текст', 'expected_edited_at':None})
            assert edited.status_code == 200, edited.text
            assert client.get(f'/api/channels/{channel}/messages/search', headers=headers, params={'query':'Привет'}).json() == []
            assert client.get(f'/api/channels/{channel}/messages/search', headers=headers, params={'query':'новл'}).json()[0]['id'] == str(mid)
        finally:
            delete_server(group['id'])
            delete_user(user['email'])


def test_backfill_rotation_resume_and_wrong_key_startup(tmp_path, ring, monkeypatch):
    from sqlalchemy import select
    from app.main import app
    from app.db.models import Attachment, EncryptionCleanup, Message, EncryptionKeyCheck
    from app.db.session import SessionLocal
    from app.services.attachment_storage import resolve_attachment_path
    from app.services.encryption_migration import migrate, status, verify
    from app.encryption_admin import generate_keyring
    from test_auth_workspace import register_regular_user, delete_user, delete_server
    monkeypatch.setattr(get_settings(), 'uploads_dir', str(tmp_path / 'uploads'))
    with TestClient(app) as client:
        token, user = register_regular_user(client)
        headers = {'Authorization':'Bearer '+token}
        group = client.post('/api/conversations/group', headers=headers, json={'name':'Backfill test','member_user_ids':[]}).json()
        try:
            message = client.post(f"/api/channels/{group['primary_channel_id']}/messages", headers=headers,
                data={'content':'Legacy text'}, files={'files':('old.txt',b'legacy file bytes','text/plain')}).json()
            with SessionLocal() as db:
                mid, aid = UUID(message['id']), UUID(message['attachments'][0]['id'])
                attachment = db.get(Attachment, aid)
                encrypted = resolve_attachment_path(attachment.storage_path)
                legacy = Path(str(encrypted).removesuffix('.kvaenc'))
                legacy.write_bytes(b'legacy file bytes')
                encrypted.unlink()
                attachment.storage_path = attachment.storage_path.removesuffix('.kvaenc')
                db.execute(text('UPDATE messages SET content=:content, encrypted_content=NULL, search_tokens=NULL WHERE id=:id'), {'content':'Legacy text','id':mid})
                db.commit()
                assert status(db)['messages_plaintext'] >= 1
                result = migrate(db)
                assert result['files'] >= 1 and result['messages'] >= 1
                assert not legacy.exists()
                assert migrate(db) == {'messages':0,'room_messages':0,'files':0}
                assert verify(db)['messages'] >= 1
                before = db.get(Message,mid).encrypted_content
                generate_keyring(ring[0], rotate=True)
                migrate(db, rotate=True)
                db.expire_all()
                after = db.get(Message,mid).encrypted_content
                assert after != before and after[4:20].hex() == crypto.required_keyring().active
                assert db.get(Message,mid).content == 'Legacy text'
                verify(db)
                rotated = json.loads(ring[0].read_text(encoding='utf-8'))
                ring[0].write_text(json.dumps({'active':ring[1]['active'], 'keys':{ring[1]['active']:base64.b64encode(os.urandom(32)).decode()}}), encoding='utf-8')
                with pytest.raises(crypto.EncryptionUnavailable):
                    crypto.check_database_keys(db)
                # Restore all keys for cleanup and later tests; remove this test's rotated probe.
                rotated['active'] = ring[1]['active']
                ring[0].write_text(json.dumps(rotated), encoding='utf-8')
                migrate(db, rotate=True)
                ring[0].write_text(json.dumps(ring[1]), encoding='utf-8')
                for check in db.scalars(select(EncryptionKeyCheck).where(EncryptionKeyCheck.key_id != ring[1]['active'])):
                    db.delete(check)
                db.commit()
        finally:
            delete_server(group['id'])
            delete_user(user['email'])
