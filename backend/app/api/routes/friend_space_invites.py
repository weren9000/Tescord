from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, and_, func
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.api.routes.invites import managed_server
from app.db.models import FriendSpaceInvite, FriendRequest, FriendRequestStatus, FriendBlock, User, Server, ServerMember, ServerKind, MemberRole
from app.db.session import get_db
from app.services.server_access import get_membership, is_server_blocked
from app.services.group_chat_defaults import ensure_group_chat_defaults
from app.services.workspace_defaults import ensure_workspace_defaults
from app.services.app_events import publish_friend_requests_changed_from_sync, publish_members_updated_from_sync, publish_servers_changed_from_sync
from app.services.rate_limits import enforce_limit

router = APIRouter(tags=['friend-space-invites'])

def friend_ids(db, user_id):
    rows = db.scalars(select(FriendRequest).where(FriendRequest.status == FriendRequestStatus.ACCEPTED,
        or_(FriendRequest.requester_user_id == user_id, FriendRequest.target_user_id == user_id))).all()
    ids = {r.target_user_id if r.requester_user_id == user_id else r.requester_user_id for r in rows}
    blocks = db.scalars(select(FriendBlock).where(or_(FriendBlock.blocker_user_id == user_id, FriendBlock.blocked_user_id == user_id))).all()
    return ids - {b.blocked_user_id if b.blocker_user_id == user_id else b.blocker_user_id for b in blocks}

class SendInvites(BaseModel):
    user_ids: list[UUID] = Field(min_length=1, max_length=50)

@router.get('/servers/{server_id}/friend-invites')
def candidates(server_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    managed_server(db, server_id, user)
    ids = friend_ids(db, user.id)
    members = set(db.scalars(select(ServerMember.user_id).where(ServerMember.server_id == server_id)).all())
    pending = set(db.scalars(select(FriendSpaceInvite.target_user_id).where(FriendSpaceInvite.server_id == server_id,
        FriendSpaceInvite.status == 'pending', FriendSpaceInvite.expires_at > datetime.now(timezone.utc))).all())
    return [{'user_id': f.id, 'nick': f.username, 'state': 'member' if f.id in members else 'pending' if f.id in pending else 'available'}
            for f in db.scalars(select(User).where(User.id.in_(ids)).order_by(User.username)).all()
            if not is_server_blocked(db, server_id, f.id)]

@router.post('/servers/{server_id}/friend-invites', status_code=201)
def send(server_id: UUID, body: SendInvites, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Same lock as link joins and member management prevents duplicate addressed invitations.
    db.scalar(select(Server).where(Server.id == server_id).with_for_update())
    managed_server(db, server_id, user)
    enforce_limit('friend-space-invite', str(user.id), 30, 3600)
    ids = set(body.user_ids)
    if not ids <= friend_ids(db, user.id):
        raise HTTPException(403, 'Можно пригласить только своих друзей')
    now = datetime.now(timezone.utc)
    for target in ids:
        if is_server_blocked(db, server_id, target):
            raise HTTPException(403, 'Приглашение недоступно')
        if get_membership(db, server_id, target):
            continue
        row = db.scalar(select(FriendSpaceInvite).where(FriendSpaceInvite.server_id == server_id, FriendSpaceInvite.target_user_id == target))
        if row and row.expires_at > now:
            if row.status == 'rejected':
                raise HTTPException(409, 'Друг отклонил приглашение. Повторить можно через 7 дней после отправки.')
            if row.status == 'pending':
                continue
        if row is None:
            row = FriendSpaceInvite(server_id=server_id, target_user_id=target)
            db.add(row)
        row.sender_user_id = user.id
        row.status = 'pending'
        row.created_at = now
        row.expires_at = now + timedelta(days=7)
    db.commit()
    for target in ids:
        publish_friend_requests_changed_from_sync([target])
    return {'sent': True}

@router.get('/friend-space-invites')
def inbox(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.platform_invitations import inbox as platform_inbox
    rows = db.execute(select(FriendSpaceInvite, Server, User).join(Server, Server.id == FriendSpaceInvite.server_id)
        .join(User, User.id == FriendSpaceInvite.sender_user_id).where(FriendSpaceInvite.target_user_id == user.id,
        FriendSpaceInvite.status == 'pending', FriendSpaceInvite.expires_at > datetime.now(timezone.utc))).all()
    friends = friend_ids(db, user.id)
    return [{'id': row.id, 'name': server.name, 'kind': server.kind.value, 'sender': sender.username}
            for row, server, sender in rows if sender.id in friends and not is_server_blocked(db, server.id, user.id)] + platform_inbox(db, user)

@router.post('/friend-space-invites/{invite_id}/{action}')
def respond(invite_id: UUID, action: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    initial = db.get(FriendSpaceInvite, invite_id)
    if initial is None:
        from app.services.platform_invitations import respond as respond_platform
        return respond_platform(db, invite_id, action, user)
    if not initial or initial.target_user_id != user.id:
        raise HTTPException(404, 'Приглашение не найдено')
    server = db.scalar(select(Server).where(Server.id == initial.server_id).with_for_update())
    row = db.scalar(select(FriendSpaceInvite).where(FriendSpaceInvite.id == invite_id).with_for_update().execution_options(populate_existing=True))
    if action not in {'accept', 'reject'}:
        raise HTTPException(400, 'Неизвестное действие')
    if not row or row.status != 'pending' or row.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, 'Приглашение уже обработано или истекло')
    if action == 'reject':
        row.status = 'rejected'
        db.commit()
        publish_friend_requests_changed_from_sync([user.id])
        return {'accepted': False}
    sender = db.get(User, row.sender_user_id)
    if not sender or sender.id not in friend_ids(db, user.id):
        raise HTTPException(403, 'Приглашение больше недоступно')
    managed_server(db, server.id, sender)
    if is_server_blocked(db, server.id, user.id):
        raise HTTPException(403, 'Сообщество заблокировано')
    if not get_membership(db, server.id, user.id):
        db.add(ServerMember(server_id=server.id, user_id=user.id, role=MemberRole.MEMBER, nickname=user.username))
        db.flush()
    text, _ = ensure_group_chat_defaults(db, server) if server.kind == ServerKind.GROUP_CHAT else ensure_workspace_defaults(db, server)
    row.status = 'accepted'
    result = {'accepted': True, 'server_id': server.id, 'channel_id': text.id}
    db.commit()
    publish_members_updated_from_sync(server.id, reason='member_added')
    publish_servers_changed_from_sync(reason='server_member_added')
    publish_friend_requests_changed_from_sync([user.id])
    return result
