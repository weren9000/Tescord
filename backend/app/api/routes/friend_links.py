from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user, bearer_scheme, resolve_user_from_token
from app.api.routes.friends import _has_friend_block, _lock_friendships, _pair_filter, _load_request_or_404
from app.db.models import User, FriendRequest, FriendRequestStatus, FriendNotice
from app.db.session import get_db
from app.services.direct_conversations import ensure_direct_conversation
from app.services.app_events import publish_friend_requests_changed_from_sync, publish_servers_changed_from_sync

router = APIRouter(prefix='/friends', tags=['friends'])


class LinkLifetime(BaseModel):
    hours: int = Field(ge=1, le=720)


def link_state(user):
    return {'code': user.friend_invite_code, 'expires_at': user.friend_invite_expires_at}


@router.get('/invite-link')
def own_link(response: Response, user: User = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return link_state(user)


@router.post('/invite-link')
def create_link(payload: LinkLifetime, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owner = db.scalar(select(User).where(User.id == user.id).with_for_update())
    owner.friend_invite_code = uuid4()
    owner.friend_invite_expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.hours)
    db.commit()
    return link_state(owner)


@router.delete('/invite-link', status_code=204)
def revoke_link(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owner = db.scalar(select(User).where(User.id == user.id).with_for_update())
    owner.friend_invite_code = None
    owner.friend_invite_expires_at = None
    db.commit()


def resolve_link(code, viewer, db, *, lock=False):
    query = select(User).where(User.friend_invite_code == code)
    if lock:
        query = query.with_for_update()
    owner = db.scalar(query)
    if not owner or not owner.friend_invite_expires_at or owner.friend_invite_expires_at <= datetime.now(timezone.utc):
        raise HTTPException(404, 'Ссылка истекла или отозвана. Попросите новую.')
    if viewer and _has_friend_block(db, viewer.id, owner.id):
        raise HTTPException(404, 'Приглашение недоступно')
    return owner


@router.get('/invites/{code}')
def preview_link(code: UUID, response: Response,
                 credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
                 db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Robots-Tag'] = 'noindex, nofollow'
    viewer = resolve_user_from_token(credentials.credentials, db) if credentials else None
    owner = resolve_link(code, viewer, db)
    return {'nick': owner.username, 'expires_at': owner.friend_invite_expires_at,
            'state': 'login' if not viewer else 'self' if owner.id == viewer.id else 'ready'}


@router.post('/invites/{code}')
def use_link(code: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _lock_friendships(db)
    owner = resolve_link(code, user, db, lock=True)
    if owner.id == user.id:
        return {'nick': owner.username, 'state': 'self'}
    server, created = ensure_direct_conversation(db, user, owner)
    requests = db.scalars(select(FriendRequest).where(_pair_filter(user.id, owner.id))).all()
    accepted = next((r for r in requests if r.status == FriendRequestStatus.ACCEPTED), None)
    if accepted is None:
        accepted = next((r for r in requests if r.status == FriendRequestStatus.PENDING), None)
        accepted = accepted or next(iter(requests), None)
        if accepted is None:
            accepted = FriendRequest(requester_user_id=user.id, target_user_id=owner.id)
            db.add(accepted)
        accepted.status = FriendRequestStatus.ACCEPTED
        accepted.responded_at = datetime.now(timezone.utc)
    for request in requests:
        if request is not accepted and request.status == FriendRequestStatus.PENDING:
            request.status = FriendRequestStatus.CANCELLED
            request.responded_at = datetime.now(timezone.utc)
    if created:
        db.add(FriendNotice(user_id=owner.id, peer_id=user.id, reason='link'))
    db.commit()
    publish_friend_requests_changed_from_sync([user.id, owner.id])
    if created:
        publish_servers_changed_from_sync(reason='friend_link_used')
    return {'nick': owner.username, 'state': 'friends', 'server_id': server.id}


@router.get('/notices')
def notices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(FriendNotice, User).join(User, User.id == FriendNotice.peer_id)
                      .where(FriendNotice.user_id == user.id).order_by(FriendNotice.created_at.desc())).all()
    return [{'id': n.id, 'user_id': peer.id, 'nick': peer.username, 'reason': n.reason} for n, peer in rows]


@router.delete('/notices/{notice_id}', status_code=204)
def dismiss_notice(notice_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notice = db.get(FriendNotice, notice_id)
    if notice and notice.user_id == user.id:
        db.delete(notice)
        db.commit()
        publish_friend_requests_changed_from_sync([user.id])


@router.post('/requests/{request_id}/cancel', status_code=204)
def cancel_request(request_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _lock_friendships(db)
    request = _load_request_or_404(request_id, db)
    if request.requester_user_id != user.id:
        raise HTTPException(403, 'Нельзя отменить чужую заявку')
    if request.status != FriendRequestStatus.PENDING:
        raise HTTPException(409, 'Заявка уже обработана')
    request.status = FriendRequestStatus.CANCELLED
    request.responded_at = datetime.now(timezone.utc)
    db.commit()
    publish_friend_requests_changed_from_sync([user.id, request.target_user_id])
