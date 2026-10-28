import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from app.db.models import AuthSession, RoomSession, User
from app.db.session import SessionLocal
from app.services import meeting_rooms as service
from test_auth_workspace import register_regular_user, delete_user
from test_meeting_rooms import meeting, auth, join


def test_meeting_success_and_errors_are_never_cached(meeting):
    c, _, owner = meeting
    for response in [c.get('/api/rooms/state', headers=auth(owner['token'])),
                     c.get('/api/rooms/state')]:
        assert response.headers['cache-control'] == 'no-store'
    c.post('/api/rooms/control', headers=auth(owner['token']), json={'action':'end'})
    response = c.get('/api/rooms/state', headers=auth(owner['token']))
    assert response.status_code == 410
    assert response.headers['cache-control'] == 'no-store'


def test_registered_profile_is_server_authoritative_and_guest_is_separate(meeting):
    c, _, owner = meeting
    token, registration = register_regular_user(c)
    try:
        me = c.get('/api/me', headers=auth(token)).json()
        nonce = secrets.token_urlsafe(32)
        response = c.post('/api/rooms/invite/'+owner['invite']+'/join', headers=auth(token),
                          json={'nonce':nonce, 'name':'Impersonation', 'user_id':owner['user_id'], 'avatar_updated_at':'fake'})
        assert response.status_code == 200, response.text
        member = response.json()
        assert member['user_id'] == me['id'] and not member['is_owner']
        assert c.post('/api/rooms/control',headers=auth(member['token']),json={'action':'end'}).status_code == 403
        guest = join(c,owner,nonce).json()
        assert guest['participant_id'] != member['participant_id'] and guest['user_id'] is None
        people = c.get('/api/rooms/state',headers=auth(guest['token'])).json()['participants']
        profile = next(p for p in people if p['id']==member['participant_id'])
        assert profile['name']==me['nick'] and profile['user_id']==me['id']
        assert 'email' not in profile
        c.post('/api/rooms/messages',headers=auth(member['token']),json={'content':'hello'})
        message = c.get('/api/rooms/messages',headers=auth(guest['token'])).json()[0]
        assert message['author']==me['nick'] and message['author_user_id']==me['id']
        assert c.get('/api/users/'+me['id']+'/avatar').status_code==200
        with SessionLocal() as db:
            u=db.get(User,UUID(me['id']));u.username='Updated profile';db.commit()
        people=c.get('/api/rooms/state',headers=auth(guest['token'])).json()['participants']
        assert next(p for p in people if p['id']==member['participant_id'])['name']=='Updated profile'
    finally:
        delete_user(registration['email'])


def test_account_rejoin_without_name_consumes_one_entry_and_kick_cannot_be_bypassed(meeting):
    c, _, owner = meeting
    token, registration=register_regular_user(c)
    try:
        link=c.post('/api/rooms/invite',headers=auth(owner['token']),json={'uses':1}).json()['invite']
        def enter(_):
            return c.post('/api/rooms/invite/'+link+'/join',headers=auth(token),json={'nonce':secrets.token_urlsafe(32)})
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(enter,range(4)))
        assert all(r.status_code==200 for r in results), [r.text for r in results]
        member=results[0].json()
        assert len({r.json()['participant_id'] for r in results})==1
        with SessionLocal() as db:assert db.get(RoomSession,UUID(owner['session_id'])).invite_uses==1
        assert c.get('/api/rooms/invite/'+link,headers=auth(token)).json()['can_join'] is True
        assert c.get('/api/rooms/invite/'+link).json()['can_join'] is False
        c.post('/api/rooms/control',headers=auth(owner['token']),json={'action':'kick','participant_id':member['participant_id']})
        assert enter(None).status_code==403
        assert c.get('/api/rooms/invite/'+link,headers=auth(token)).json()['can_join'] is False
    finally:
        delete_user(registration['email'])


def test_invalid_account_never_falls_back_to_guest_and_revocation_invalidates_media(meeting):
    c, _, owner=meeting
    route='/api/rooms/invite/'+owner['invite']+'/join'
    assert c.post(route,headers=auth('invalid'),json={'name':'Guest','nonce':secrets.token_urlsafe(32)}).status_code==401
    assert c.post(route,json={'nonce':secrets.token_urlsafe(32)}).status_code==422
    token, registration=register_regular_user(c)
    try:
        me=c.get('/api/me',headers=auth(token)).json()
        member=c.post(route,headers=auth(token),json={'nonce':secrets.token_urlsafe(32)}).json()
        with SessionLocal() as db:
            from app.db.models import RoomParticipant
            p=db.get(RoomParticipant,UUID(member['participant_id']));sid=p.auth_session_id
        metadata=json.dumps({'auth_sid':str(sid)})
        assert service.media_permission('meeting-'+owner['session_id'],member['participant_id'],metadata) is True
        assert service.media_permission('meeting-'+owner['session_id'],member['participant_id'],'{}') is None
        with SessionLocal() as db:
            db.get(AuthSession,sid).revoked_at=service.now();db.commit()
        assert c.get('/api/rooms/state',headers=auth(member['token'])).status_code==401
        assert c.post(route,headers=auth(token),json={'name':'Guest','nonce':secrets.token_urlsafe(32)}).status_code==401
        assert service.media_permission('meeting-'+owner['session_id'],member['participant_id'],metadata) is None
    finally:
        delete_user(registration['email'])


def test_registered_admission_respects_locked_and_expired_links(meeting):
    c, _, owner=meeting
    token, registration=register_regular_user(c)
    try:
        route='/api/rooms/invite/'+owner['invite']+'/join'
        body={'nonce':secrets.token_urlsafe(32)}
        c.post('/api/rooms/control',headers=auth(owner['token']),json={'action':'lock'})
        assert c.post(route,headers=auth(token),json=body).status_code==403
        c.post('/api/rooms/control',headers=auth(owner['token']),json={'action':'unlock'})
        from datetime import timedelta
        with SessionLocal() as db:
            db.get(RoomSession,UUID(owner['session_id'])).invite_expires_at=service.now()-timedelta(seconds=1);db.commit()
        assert c.post(route,headers=auth(token),json=body).status_code==410
    finally:
        delete_user(registration['email'])
