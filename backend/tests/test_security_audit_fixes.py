"""Regressions for the November security review, using only the local test DB."""
import asyncio
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from sqlalchemy import select
from starlette.datastructures import UploadFile
from starlette.formparsers import FormParser

from app.main import app
from app.db.models import Server, ServerMember
from app.db.session import SessionLocal
from app.api.dependencies import upload_admission
from app.services import safe_images, image_previews
from test_auth_workspace import register_regular_user, get_current_user_profile, delete_user, delete_server


@pytest.fixture
def people():
    groups = []
    with TestClient(app) as client:
        a, pa = register_regular_user(client)
        b, pb = register_regular_user(client)
        profiles = [get_current_user_profile(client, t) for t in (a, b)]
        headers = [{'Authorization': f'Bearer {t}'} for t in (a, b)]
        try:
            yield client, headers, profiles, groups
        finally:
            for key in groups:
                delete_server(key)
            for payload in (pa, pb):
                delete_user(payload['email'])


def create_group(client, headers, groups, members=()):
    response = client.post('/api/conversations/group', headers=headers,
                           json={'name': 'Security regression', 'member_ids': list(members)})
    assert response.status_code == 201, response.text
    groups.append(response.json()['id'])
    return response.json()


@pytest.mark.parametrize('content_type', ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=test'])
def test_anonymous_form_rejected_without_reading_body(content_type):
    async def check():
        async def never(*args):
            raise AssertionError('Anonymous form reached the body reader or application')
        sent = []
        async def send(message):
            sent.append(message)
        scope = {'type': 'http', 'path': f'/api/channels/{uuid4()}/messages',
                 'headers': [(b'content-type', content_type.encode())]}
        await upload_admission.UploadAdmissionMiddleware(never)(scope, never, send)
        assert sent[0]['status'] == 401
    asyncio.run(check())


def test_actual_fastapi_rejects_urlencoded_before_parser(monkeypatch):
    async def forbidden_parse(self):
        raise AssertionError('Parser ran before authentication')
    monkeypatch.setattr(FormParser, 'parse', forbidden_parse)
    with TestClient(app) as client:
        response = client.post(f'/api/channels/{uuid4()}/messages',
                               content=b'field=a&' * 2049,
                               headers={'Content-Type': 'application/x-www-form-urlencoded'})
        assert response.status_code == 401


@pytest.mark.parametrize('path,content_type,size', [
    ('/api/me/profile', b'multipart/form-data; boundary=test', 3 * 1024 * 1024),
    ('/api/channels/test/messages', b'application/x-www-form-urlencoded', 65 * 1024),
])
@pytest.mark.parametrize('declared', [False, True])
def test_form_limits_include_streamed_bodies(monkeypatch, path, content_type, size, declared):
    monkeypatch.setattr(upload_admission, '_authenticate', lambda *args: None)
    async def check():
        entered = False
        async def downstream(scope, receive, send):
            nonlocal entered
            entered = True
            await receive()
            raise AssertionError('Oversized body was admitted')
        async def receive():
            return {'type': 'http.request', 'body': b'x' * size, 'more_body': False}
        sent = []
        async def send(message):
            sent.append(message)
        headers = [(b'content-type', content_type), (b'authorization', b'Bearer test')]
        if declared:
            headers.append((b'content-length', str(size).encode()))
        await upload_admission.UploadAdmissionMiddleware(downstream)(
            {'type': 'http', 'path': path, 'headers': headers}, receive, send)
        assert sent[0]['status'] == 413
        assert entered is not declared
    asyncio.run(check())


def test_public_id_lookup_and_events_do_not_disclose_email(people):
    from app.services.workspace_events import _build_server_member_summary
    client, (a, b), (pa, pb), groups = people
    chat = create_group(client, a, groups)
    response = client.post(f"/api/servers/{chat['id']}/members", headers=a,
                           json={'user_public_id': pb['public_id']})
    assert response.status_code == 200
    assert response.json()['login'] == str(pb['public_id'])
    for url in (f"/api/servers/{chat['id']}/members", '/api/conversations'):
        body = client.get(url, headers=a).text
        assert pa['email'] not in body and pb['email'] not in body
    with SessionLocal() as db:
        member = db.scalar(select(ServerMember).where(ServerMember.server_id == UUID(chat['id']),
                                                       ServerMember.user_id == UUID(pb['id'])))
        event = _build_server_member_summary(member, member.user, set()).model_dump_json()
        assert pb['email'] not in event
    own = client.get('/api/me', headers=b)
    assert own.json()['email'] == pb['email']


@pytest.mark.parametrize('reverse', [False, True])
def test_personal_block_prevents_new_groups_and_additions(people, reverse):
    client, headers, profiles, groups = people
    a, b = headers
    pa, pb = profiles
    empty = create_group(client, a, groups)
    blocker, blocked_id = (a, pb['id']) if reverse else (b, pa['id'])
    assert client.post(f'/api/friends/{blocked_id}/block', headers=blocker).status_code == 204
    before = client.get('/api/conversations', headers=a).json()
    denied = client.post('/api/conversations/group', headers=a,
                         json={'name': 'Blocked contact', 'member_ids': [pb['id']]})
    assert denied.status_code == 403
    assert len(client.get('/api/conversations', headers=a).json()) == len(before)
    for target in ({'user_id': pb['id']}, {'user_public_id': pb['public_id']}):
        denied = client.post(f"/api/servers/{empty['id']}/members", headers=a, json=target)
        assert denied.status_code == 403
    with SessionLocal() as db:
        assert db.scalar(select(ServerMember.id).where(ServerMember.server_id == UUID(empty['id']),
                                                        ServerMember.user_id == UUID(pb['id']))) is None
    assert client.delete(f'/api/friends/blocked/{blocked_id}', headers=blocker).status_code == 204
    create_group(client, a, groups, [pb['id']])


def png(size=(64, 64), metadata=False):
    buffer = BytesIO()
    info = PngImagePlugin.PngInfo()
    if metadata:
        info.add_text('private-test-metadata', 'must not survive normalization')
    with Image.new('RGBA', size, (30, 60, 90, 150)) as image:
        image.save(buffer, 'PNG', pnginfo=info)
    return buffer.getvalue()


def test_icons_reject_invalid_dimensions_and_bound_file_reads(people, monkeypatch):
    client, (a, _), _, groups = people
    chat = create_group(client, a, groups)
    url = f"/api/servers/{chat['id']}/icon-file"
    original_read = UploadFile.read
    sizes = []
    async def record(self, size=-1):
        sizes.append(size)
        return await original_read(self, size)
    monkeypatch.setattr(UploadFile, 'read', record)
    # Small enough for the multipart admission cap, too large for the actual file cap.
    oversized = client.put(url, headers=a, files={'icon': ('icon.png', b'x' * (2 * 1024 * 1024 + 2), 'image/png')})
    assert oversized.status_code == 400
    assert sizes and all(0 <= n <= safe_images.PROFILE_MAX_BYTES + 1 for n in sizes)
    for content in (b'not an image', png((2100, 2100))):
        response = client.put(url, headers=a, files={'icon': ('icon.png', content, 'image/png')})
        assert response.status_code == 400
    assert client.get(url).status_code == 404
    good = client.put(url, headers=a, files={'icon': ('icon.png', png((1200, 800), True), 'image/png')})
    assert good.status_code == 200
    with Image.open(BytesIO(client.get(url).content)) as image:
        assert max(image.size) <= 512
        assert 'private-test-metadata' not in image.info
    assert client.get(url + '?preview=true').status_code == 200


def test_legacy_corrupt_icons_return_controlled_error(people):
    client, (a, _), _, groups = people
    chat = create_group(client, a, groups)
    with SessionLocal() as db:
        server = db.get(Server, UUID(chat['id']))
        server.icon_content, server.icon_mime_type = b'old corrupt content', 'image/png'
        db.commit()
    assert client.get(f"/api/servers/{chat['id']}/icon-file?preview=true").status_code == 400


def test_preview_processing_is_bounded_and_returns_capacity_error(tmp_path, monkeypatch):
    monkeypatch.setattr(image_previews, '_uploads_root', lambda: tmp_path)
    with safe_images.bounded_image(BytesIO(png())):
        with pytest.raises(HTTPException) as error:
            image_previews.small_preview_response(png((65, 65)))
        assert error.value.status_code == 429
    # Capacity is released even after an error.
    with pytest.raises(HTTPException):
        safe_images.normalize_profile_image(b'bad')
    assert safe_images.normalize_profile_image(png())[1] == 'image/png'
