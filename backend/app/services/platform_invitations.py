from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import Platform, PlatformMember, PlatformFriendInvite, User, MemberRole, Channel, ChannelType
from app.services.platforms import platform_context, add_member, platform_chats
from app.services.app_events import publish_friend_requests_changed_from_sync, publish_servers_changed_from_sync


def friends(db, user_id):
    from app.api.routes.friend_space_invites import friend_ids
    return friend_ids(db, user_id)


def candidates(db, platform_id, user):
    platform_context(db, platform_id, user.id, manage=True)
    members = set(db.scalars(select(PlatformMember.user_id).where(PlatformMember.platform_id == platform_id)))
    invites = {r.target_user_id: r for r in db.scalars(select(PlatformFriendInvite).where(
        PlatformFriendInvite.platform_id == platform_id, PlatformFriendInvite.expires_at > datetime.now(timezone.utc)))}
    return [{'user_id': f.id, 'nick': f.username, 'avatar_updated_at': f.avatar_updated_at,
             'state': 'member' if f.id in members else invites[f.id].status if f.id in invites and invites[f.id].status in {'pending', 'rejected'} else 'available'}
            for f in db.scalars(select(User).where(User.id.in_(friends(db, user.id))).order_by(User.username))]


def send(db, platform_id, user, ids):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    ids = set(ids)
    if not ids <= friends(db, user.id):
        raise HTTPException(403, 'Можно пригласить только своих друзей')
    now = datetime.now(timezone.utc)
    sent = 0
    for target in ids:
        if db.scalar(select(PlatformMember.id).where(PlatformMember.platform_id == platform_id, PlatformMember.user_id == target)):
            continue
        row = db.scalar(select(PlatformFriendInvite).where(PlatformFriendInvite.platform_id == platform_id, PlatformFriendInvite.target_user_id == target))
        if row and row.expires_at > now and row.status in {'pending', 'rejected'}:
            continue
        if row is None:
            row = PlatformFriendInvite(platform_id=platform_id, target_user_id=target)
            db.add(row)
        row.sender_user_id, row.status, row.created_at, row.expires_at = user.id, 'pending', now, now + timedelta(days=7)
        sent += 1
    db.commit()
    publish_friend_requests_changed_from_sync(list(ids))
    return {'sent': sent}


def inbox(db, user):
    from app.api.routes.platforms import icon_url
    rows = db.execute(select(PlatformFriendInvite, Platform, User)
        .join(Platform, Platform.id == PlatformFriendInvite.platform_id)
        .join(User, User.id == PlatformFriendInvite.sender_user_id)
        .where(PlatformFriendInvite.target_user_id == user.id, PlatformFriendInvite.status == 'pending',
               PlatformFriendInvite.expires_at > datetime.now(timezone.utc))).all()
    allowed = friends(db, user.id)
    result = []
    for row, platform, sender in rows:
        if db.scalar(select(PlatformMember.id).where(PlatformMember.platform_id == platform.id, PlatformMember.user_id == user.id)):
            continue
        manager = db.scalar(select(PlatformMember).where(PlatformMember.platform_id == platform.id, PlatformMember.user_id == sender.id))
        if sender.id in allowed and manager and manager.role in {MemberRole.OWNER, MemberRole.ADMIN}:
            result.append({'id': row.id, 'name': platform.name, 'kind': 'platform', 'sender': sender.username, 'icon_url': icon_url(platform)})
    return result


def respond(db, invite_id, action, user):
    initial = db.get(PlatformFriendInvite, invite_id)
    if not initial or initial.target_user_id != user.id:
        raise HTTPException(404, 'Приглашение не найдено')
    platform = db.scalar(select(Platform).where(Platform.id == initial.platform_id).with_for_update())
    row = db.scalar(select(PlatformFriendInvite).where(PlatformFriendInvite.id == invite_id).with_for_update().execution_options(populate_existing=True))
    if action not in {'accept', 'reject'}:
        raise HTTPException(400, 'Неизвестное действие')
    if not platform or not row or row.status != 'pending' or row.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, 'Приглашение уже обработано или истекло')
    result = {'accepted': False}
    if action == 'accept':
        if row.sender_user_id not in friends(db, user.id):
            raise HTTPException(403, 'Приглашение больше недоступно')
        platform_context(db, platform.id, row.sender_user_id, manage=True)
        add_member(db, platform, user)
        chats = platform_chats(db, platform.id)
        if not chats:
            from app.services.platforms import create_chat
            chats = [create_chat(db, platform, 'Общий')]
        channel = db.scalar(select(Channel).where(Channel.server_id == chats[0].id, Channel.type == ChannelType.TEXT).order_by(Channel.position))
        result = {'accepted': True, 'platform_id': platform.id, 'server_id': chats[0].id, 'channel_id': channel.id}
    row.status = 'accepted' if action == 'accept' else 'rejected'
    db.commit()
    publish_friend_requests_changed_from_sync([user.id])
    if action == 'accept':
        publish_servers_changed_from_sync(reason='platform_member_added')
    return result
