import asyncio
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.main import app
from app.db.models import RoomSession, RoomParticipant, RoomMessage, RoomUpload, MeetingRoom, AuthSession
from app.db.session import SessionLocal
from app.services import meeting_rooms as service
from app.core.config import get_settings
from test_auth_workspace import register_regular_user, delete_user, TEST_PNG_BYTES


def auth(token):
    return {'Authorization': 'Bearer '+token}


@pytest.fixture
def meeting(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), 'uploads_dir', str(tmp_path/'uploads'))
    monkeypatch.setattr(get_settings(), 'livekit_url', None)
    with TestClient(app) as client:
        user, payload = register_regular_user(client)
        r = client.post('/api/rooms/start', headers=auth(user), json={'uses':100})
        assert r.status_code == 200, r.text
        yield client, user, r.json()
        with SessionLocal() as db:
            for mid in db.scalars(select(RoomSession.id)):
                m = db.get(RoomSession, mid)
                m.ended_at = service.now()
            db.commit()
        for mid in service.expire_sessions():
            asyncio.run(service.cleanup(mid))
        delete_user(payload['email'])


def join(c, ticket, nonce=None):
    return c.post('/api/rooms/invite/'+ticket['invite']+'/join', json={'name':'Guest','nonce':nonce or secrets.token_urlsafe(32)})


def test_guest_scope_and_one_room(meeting):
    c, user, t = meeting
    second=c.post('/api/rooms/start', headers=auth(user), json={})
    assert second.json()['session_id']==t['session_id']
    assert c.post('/api/rooms/start', json={}).status_code in {401,403}
    guest=join(c,t).json()
    assert c.get('/api/me',headers=auth(guest['token'])).status_code==401
    assert c.get('/api/rooms/state',headers=auth(user)).status_code==401
    assert c.post('/api/rooms/control',headers=auth(guest['token']),json={'action':'end'}).status_code==403
    assert c.get('/api/rooms/state',headers=auth(guest['token'])).status_code==200


def test_link_usage_is_atomic_and_reconnect_free(meeting):
    c, _, t=meeting
    new=c.post('/api/rooms/invite',headers=auth(t['token']),json={'uses':1}).json()
    assert join(c,t).status_code==410
    t={**t,**new}
    for _ in range(3):assert c.get('/api/rooms/invite/'+t['invite']).status_code==200
    nonce=secrets.token_urlsafe(32)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda _:join(c,t,nonce),range(4)))
    assert all(r.status_code==200 for r in results),[r.text for r in results]
    assert len({r.json()['participant_id'] for r in results})==1
    assert join(c,t).status_code==410
    with SessionLocal() as db:assert db.get(RoomSession,UUID(t['session_id'])).invite_uses==1


def test_fifty_capacity_and_owner_reserved(meeting):
    c, user, t=meeting
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses=list(pool.map(lambda _:join(c,t),range(55)))
    assert sum(r.status_code==200 for r in responses)==49
    assert sum(r.status_code==409 for r in responses)==6
    assert c.post('/api/rooms/leave',headers=auth(t['token'])).status_code==200
    assert join(c,t).status_code==409
    assert c.post('/api/rooms/start',headers=auth(user),json={}).status_code==200


def test_owner_five_minutes_return_and_expiry(meeting):
    c,user,t=meeting
    guest=join(c,t).json()
    c.post('/api/rooms/leave',headers=auth(t['token']))
    with SessionLocal() as db:
        m=db.get(RoomSession,UUID(t['session_id']));m.owner_left_at=service.now()-timedelta(seconds=299);db.commit()
    assert c.post('/api/rooms/heartbeat',headers=auth(guest['token'])).status_code==200
    assert c.post('/api/rooms/start',headers=auth(user),json={}).status_code==200
    with SessionLocal() as db:
        m=db.get(RoomSession,UUID(t['session_id']));assert m.owner_left_at is None
        m.owner_seen_at=service.now()-timedelta(seconds=301);db.commit()
    assert c.get('/api/rooms/state',headers=auth(guest['token'])).status_code==410
    assert service.media_permission('meeting-'+t['session_id'],guest['participant_id']) is None


def test_lock_kick_and_silence(meeting):
    c,_,t=meeting
    g=join(c,t).json();h=auth(t['token'])
    assert c.post('/api/rooms/control',headers=h,json={'action':'lock'}).status_code==200
    assert join(c,t).status_code==403
    assert c.post('/api/rooms/heartbeat',headers=auth(g['token'])).status_code==200
    c.post('/api/rooms/control',headers=h,json={'action':'silence','participant_id':g['participant_id']})
    assert service.media_permission('meeting-'+t['session_id'],g['participant_id']) is False
    c.post('/api/rooms/control',headers=h,json={'action':'kick','participant_id':g['participant_id']})
    assert c.get('/api/rooms/state',headers=auth(g['token'])).status_code==403
    assert service.media_permission('meeting-'+t['session_id'],g['participant_id']) is None


def test_chat_files_and_full_cleanup(meeting):
    c,_,t=meeting
    g=join(c,t).json();h=auth(g['token']);owner=auth(t['token'])
    u=c.post('/api/rooms/uploads',headers=h,files={'file':('image.png',TEST_PNG_BYTES,'image/png')})
    assert u.status_code==200,u.text
    uid=u.json()['id']
    assert c.get('/api/rooms/uploads/'+uid,headers=owner).status_code==404
    sent=c.post('/api/rooms/messages',headers=h,json={'content':'hello','uploads':[uid]})
    assert sent.status_code==200,sent.text
    mid=sent.json()['id']
    assert c.get('/api/rooms/uploads/'+uid,headers=owner).content==TEST_PNG_BYTES
    assert c.get('/api/rooms/uploads/'+uid+'?preview=true',headers=owner).status_code==200
    assert c.patch('/api/rooms/messages/'+mid,headers=owner,json={'content':'changed'}).status_code==403
    assert c.patch('/api/rooms/messages/'+mid,headers=h,json={'content':'changed'}).status_code==200
    assert c.post('/api/rooms/messages',headers=owner,json={'content':'reply','reply_to_id':mid}).status_code==200
    for _ in range(2):assert c.post('/api/rooms/messages/'+mid+'/reaction',headers=owner,json={'emoji':'👍'}).status_code==200
    messages=c.get('/api/rooms/messages',headers=h).json()
    assert messages[0]['content']=='changed' and not messages[0]['reactions']
    assert c.post('/api/rooms/control',headers=owner,json={'action':'end'}).status_code==200
    assert c.get('/api/rooms/uploads/'+uid,headers=h).status_code==410
    mid=UUID(t['session_id']);asyncio.run(service.cleanup(mid))
    assert not service.files_root(mid).exists()
    with SessionLocal() as db:
        assert db.get(RoomSession,mid) is None
        assert db.scalar(select(func.count()).select_from(RoomParticipant).where(RoomParticipant.session_id==mid))==0
        assert db.scalar(select(func.count()).select_from(RoomMessage).where(RoomMessage.session_id==mid))==0
        assert db.scalar(select(func.count()).select_from(RoomUpload).where(RoomUpload.session_id==mid))==0
        assert db.scalar(select(func.count()).select_from(MeetingRoom))>=1


def test_cross_meeting_denied(meeting):
    c,_,t=meeting
    other,payload=register_regular_user(c)
    try:
        t2=c.post('/api/rooms/start',headers=auth(other),json={}).json()
        message=c.post('/api/rooms/messages',headers=auth(t2['token']),json={'content':'secret'}).json()['id']
        assert c.post('/api/rooms/messages',headers=auth(t['token']),json={'content':'probe','reply_to_id':message}).status_code==404
        assert c.delete('/api/rooms/messages/'+message,headers=auth(t['token'])).status_code==404
    finally:delete_user(payload['email'])


def test_expired_link_does_not_disconnect_existing_guests(meeting):
    c,_,t=meeting
    guest=join(c,t).json()
    with SessionLocal() as db:
        m=db.get(RoomSession,UUID(t['session_id']));m.invite_expires_at=service.now()-timedelta(seconds=1);db.commit()
    assert join(c,t).status_code==410
    assert c.post('/api/rooms/heartbeat',headers=auth(guest['token'])).status_code==200


def test_owner_auth_revocation_cannot_revive_old_capability(meeting):
    c,user,t=meeting
    with SessionLocal() as db:
        p=db.get(RoomParticipant,UUID(t['participant_id']));sid=p.auth_session_id
        auth_session=db.get(AuthSession,sid);auth_session.revoked_at=service.now();db.commit()
    assert c.post('/api/rooms/heartbeat',headers=auth(t['token'])).status_code==401
    # Simulate a new account login reattaching ownership. The old scoped token
    # must remain invalid even though the participant identity is preserved.
    from uuid import uuid4
    with SessionLocal() as db:
        old=db.get(AuthSession,sid)
        new=AuthSession(id=uuid4(),user_id=old.user_id,expires_at=service.now()+timedelta(days=1))
        db.add(new);db.flush();db.get(RoomParticipant,UUID(t['participant_id'])).auth_session_id=new.id;db.commit()
    assert c.post('/api/rooms/heartbeat',headers=auth(t['token'])).status_code==401


def test_unauthenticated_multipart_rejected_and_text_preview_bounded(meeting):
    c,_,t=meeting
    assert c.post('/api/rooms/uploads',files={'file':('x.txt',b'x')}).status_code==401
    h=auth(t['token'])
    response=c.post('/api/rooms/uploads',headers=h,files={'file':('code.txt',b'x'*(2*1024*1024))})
    assert response.status_code==200,response.text
    preview=c.get('/api/rooms/uploads/'+response.json()['id']+'?text_preview=true',headers=h)
    assert len(preview.content)==1024*1024+1
    assert preview.headers['cache-control']=='no-store'
