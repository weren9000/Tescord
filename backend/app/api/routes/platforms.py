from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import Attachment, Channel, ChannelType, MemberRole, Message, Platform, PlatformInvite, PlatformMember, Server, User
from app.db.session import get_db
from app.services.app_events import publish_servers_changed_from_sync
from app.services.platforms import (add_member, create_chat, ensure_target_manageable,
    platform_chats, platform_context, remove_member, set_member_role)
from app.services.rate_limits import enforce_limit
from app.services.voice_sfu import enforce_participant
from app.services.voice_signaling import voice_signaling_manager

router = APIRouter(prefix="/platforms", tags=["platforms"])


class PlatformName(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Название не может быть пустым")
        return value.strip()


class PlatformDetails(PlatformName):
    description: str | None = Field(default=None, max_length=2000)


class MemberRoleRequest(BaseModel):
    role: Literal["admin", "member"]


class TransferRequest(BaseModel):
    user_id: UUID


class ChatOrder(BaseModel):
    chat_ids: list[UUID]


class Notifications(BaseModel):
    enabled: bool


class InviteRequest(BaseModel):
    expires_in_days: Literal[1, 7, 30] = 1
    expires_in_hours: Literal[1, 24, 168] | None = 24
    max_uses: int | None = Field(default=None, ge=1, le=10000)


def changed(db):
    db.commit()
    publish_servers_changed_from_sync(reason="platform_changed")


def member_or_404(db, platform_id, user_id):
    member = db.scalar(select(PlatformMember).where(PlatformMember.platform_id == platform_id, PlatformMember.user_id == user_id))
    if member is None:
        raise HTTPException(404, "Участник не найден")
    return member


def summary(platform, member):
    return {"id": platform.id, "name": platform.name, "description": platform.description,
            "owner_id": platform.owner_id, "member_role": member.role.value,
            "notifications_enabled": member.notifications_enabled, "icon_url": icon_url(platform)}


def icon_url(platform):
    if platform.icon_catalog_id:
        return f'/api/inventory/assets/{platform.icon_catalog_id}?preview=true'
    if platform.icon_updated_at:
        return f'/api/platforms/{platform.id}/icon?v={platform.icon_updated_at.timestamp()}'
    return None


class IconChoice(BaseModel):
    item_id: UUID


class FriendInvitesRequest(BaseModel):
    user_ids: list[UUID] = Field(min_length=1, max_length=50)


@router.get('/{platform_id}/friend-invites')
def friend_candidates(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.platform_invitations import candidates
    return candidates(db, platform_id, user)


@router.post('/{platform_id}/friend-invites', status_code=201)
def invite_friends(platform_id: UUID, body: FriendInvitesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.platform_invitations import send
    enforce_limit('platform-friend-invite', str(user.id), 30, 3600)
    return send(db, platform_id, user, body.user_ids)


@router.put('/{platform_id}/icon')
async def upload_icon(platform_id: UUID, icon: UploadFile = File(...),
                      crop_x: float = Form(0.5, ge=0, le=1), crop_y: float = Form(0.5, ge=0, le=1),
                      zoom: float = Form(1, ge=1, le=4),
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.collectible_uploads import prepare_image
    platform_context(db, platform_id, user.id, manage=True)
    try:
        payload = await icon.read(10 * 1024 * 1024 + 1)
    finally:
        await icon.close()
    content = await run_in_threadpool(prepare_image, payload, 'avatar', crop_x, crop_y, zoom)
    platform, member = platform_context(db, platform_id, user.id, manage=True, lock=True)
    platform.icon_content, platform.icon_catalog_id = content, None
    platform.icon_updated_at = datetime.now(timezone.utc)
    changed(db)
    return summary(platform, member)


@router.patch('/{platform_id}/icon')
def select_icon(platform_id: UUID, body: IconChoice, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.db.inventory import InventoryItem
    from app.services.inventory import lock_inventory
    platform, member = platform_context(db, platform_id, user.id, manage=True, lock=True)
    lock_inventory(db)
    item = db.get(InventoryItem, body.item_id)
    if not item or item.owner_id != user.id or item.revoked or item.kind != 'avatar':
        raise HTTPException(403, 'Выберите аватар из своего инвентаря')
    platform.icon_catalog_id, platform.icon_content = item.catalog_id, None
    platform.icon_updated_at = datetime.now(timezone.utc)
    changed(db)
    return summary(platform, member)


@router.delete('/{platform_id}/icon', status_code=204)
def reset_icon(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, _ = platform_context(db, platform_id, user.id, manage=True, lock=True)
    platform.icon_catalog_id = platform.icon_content = platform.icon_updated_at = None
    changed(db)
    return Response(status_code=204)


@router.get('/{platform_id}/icon')
def read_icon(platform_id: UUID, db: Session = Depends(get_db)):
    platform = db.get(Platform, platform_id)
    if not platform or not platform.icon_content:
        raise HTTPException(404, 'Иконка не найдена')
    return Response(platform.icon_content, media_type='image/webp', headers={'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'})


@router.get("")
def list_platforms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Platform, PlatformMember).join(PlatformMember, PlatformMember.platform_id == Platform.id)
                      .where(PlatformMember.user_id == user.id).order_by(Platform.name)).all()
    return [summary(platform, member) for platform, member in rows]


@router.post("", status_code=201)
def create_platform(body: PlatformDetails, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_limit("platform-create", str(user.id), 20, 3600)
    platform = Platform(name=body.name, description=body.description, owner_id=user.id)
    db.add(platform)
    db.flush()
    member = PlatformMember(platform_id=platform.id, user_id=user.id, role=MemberRole.OWNER)
    db.add(member)
    db.flush()
    chat = create_chat(db, platform, "Общий")
    changed(db)
    return {**summary(platform, member), "chat_id": chat.id}


@router.patch("/{platform_id}")
def edit_platform(platform_id: UUID, body: PlatformDetails, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, member = platform_context(db, platform_id, user.id, manage=True, lock=True)
    platform.name, platform.description = body.name, body.description
    changed(db)
    return summary(platform, member)


@router.get("/{platform_id}/members")
def list_members(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id)
    rows = db.execute(select(PlatformMember, User).join(User, User.id == PlatformMember.user_id)
                      .where(PlatformMember.platform_id == platform_id).order_by(User.username)).all()
    return [{"user_id": person.id, "nick": person.username, "public_id": person.public_id,
             "role": member.role.value, "avatar_updated_at": person.avatar_updated_at} for member, person in rows]


@router.put("/{platform_id}/members/{user_id}/role", status_code=204)
def change_role(platform_id: UUID, user_id: UUID, body: MemberRoleRequest,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, actor = platform_context(db, platform_id, user.id, owner=True, lock=True)
    target = member_or_404(db, platform_id, user_id)
    ensure_target_manageable(actor, target)
    set_member_role(db, platform, target, MemberRole(body.role))
    changed(db)
    return Response(status_code=204)


@router.post("/{platform_id}/transfer", status_code=204)
def transfer(platform_id: UUID, body: TransferRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, actor = platform_context(db, platform_id, user.id, owner=True, lock=True)
    target = member_or_404(db, platform_id, body.user_id)
    ensure_target_manageable(actor, target)
    platform.owner_id = target.user_id
    set_member_role(db, platform, actor, MemberRole.ADMIN)
    set_member_role(db, platform, target, MemberRole.OWNER)
    for chat in platform_chats(db, platform_id):
        chat.owner_id = target.user_id
    changed(db)
    return Response(status_code=204)


async def revoke_membership(db, platform, target):
    user_id = target.user_id
    voice_ids = remove_member(db, platform, target)
    changed(db)
    for channel_id in voice_ids:
        await enforce_participant(channel_id, user_id, can_publish=None)
        await voice_signaling_manager.disconnect_user_sessions(str(channel_id), str(user_id))
    return Response(status_code=204)


@router.delete("/{platform_id}/members/{user_id}", status_code=204)
async def kick_member(platform_id: UUID, user_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, actor = platform_context(db, platform_id, user.id, manage=True, lock=True)
    target = member_or_404(db, platform_id, user_id)
    ensure_target_manageable(actor, target)
    return await revoke_membership(db, platform, target)


@router.post("/{platform_id}/leave", status_code=204)
async def leave(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, member = platform_context(db, platform_id, user.id, lock=True)
    if member.role == MemberRole.OWNER:
        raise HTTPException(409, "Передайте владение или удалите площадку перед выходом")
    return await revoke_membership(db, platform, member)


@router.put("/{platform_id}/notifications", status_code=204)
def notifications(platform_id: UUID, body: Notifications, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _, member = platform_context(db, platform_id, user.id)
    member.notifications_enabled = body.enabled
    changed(db)
    return Response(status_code=204)


@router.post("/{platform_id}/chats", status_code=201)
def add_chat(platform_id: UUID, body: PlatformName, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, _ = platform_context(db, platform_id, user.id, manage=True, lock=True)
    chat = create_chat(db, platform, body.name)
    changed(db)
    return {"id": chat.id}


@router.put("/{platform_id}/chats/order", status_code=204)
def reorder(platform_id: UUID, body: ChatOrder, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    chats = {chat.id: chat for chat in platform_chats(db, platform_id)}
    if len(body.chat_ids) != len(chats) or set(body.chat_ids) != set(chats):
        raise HTTPException(409, "Список чатов изменился. Обновите площадку")
    for index, chat_id in enumerate(body.chat_ids):
        chats[chat_id].platform_position = index
    changed(db)
    return Response(status_code=204)


def chat_or_404(db, platform_id, chat_id):
    chat = db.get(Server, chat_id)
    if chat is None or chat.platform_id != platform_id:
        raise HTTPException(404, "Чат недоступен")
    return chat


@router.patch("/{platform_id}/chats/{chat_id}", status_code=204)
def rename_chat(platform_id: UUID, chat_id: UUID, body: PlatformName,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    chat_or_404(db, platform_id, chat_id).name = body.name
    changed(db)
    return Response(status_code=204)


async def delete_chats(db, chats):
    # Reuse attachment collection, but remove files only after the DB transaction.
    from app.api.routes.servers import _collect_server_attachment_storage_paths
    paths, voice_ids = [], []
    for chat in chats:
        paths.extend(_collect_server_attachment_storage_paths(db, chat.id))
        voice_ids.extend(db.scalars(select(Channel.id).where(Channel.server_id == chat.id, Channel.type == ChannelType.VOICE)))
        db.delete(chat)
    db.flush()
    return paths, voice_ids


async def finish_deletion(db, paths, voice_ids):
    from app.services.attachment_storage import delete_stored_attachment
    changed(db)
    for channel_id in voice_ids:
        await voice_signaling_manager.disconnect_channel_sessions(str(channel_id))
    for path in paths:
        if db.scalar(select(Attachment.id).where(Attachment.storage_path == path).limit(1)) is None:
            delete_stored_attachment(path)
    return Response(status_code=204)


@router.delete("/{platform_id}/chats/{chat_id}", status_code=204)
async def delete_chat(platform_id: UUID, chat_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    chat = chat_or_404(db, platform_id, chat_id)
    paths, voice_ids = await delete_chats(db, [chat])
    return await finish_deletion(db, paths, voice_ids)


@router.delete("/{platform_id}", status_code=204)
async def delete_platform(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform, _ = platform_context(db, platform_id, user.id, owner=True, lock=True)
    paths, voice_ids = await delete_chats(db, platform_chats(db, platform_id))
    db.delete(platform)
    return await finish_deletion(db, paths, voice_ids)


@router.post("/{platform_id}/invites", status_code=201)
def invite(platform_id: UUID, body: InviteRequest, response: Response,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    enforce_limit("platform-invite", str(user.id), 30, 3600)
    token = secrets.token_urlsafe(32)
    row = PlatformInvite(platform_id=platform_id, created_by_id=user.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(), max_uses=body.max_uses,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
                    if 'expires_in_days' in body.model_fields_set and 'expires_in_hours' not in body.model_fields_set
                    else datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours) if body.expires_in_hours is not None else None))
    db.add(row)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"id": row.id, "token": token, "expires_at": row.expires_at}


@router.get("/{platform_id}/invites")
def invites(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True)
    return [{"id": row.id, "expires_at": row.expires_at, "revoked_at": row.revoked_at, "uses": row.uses, "max_uses": row.max_uses}
            for row in db.scalars(select(PlatformInvite).where(PlatformInvite.platform_id == platform_id).order_by(PlatformInvite.created_at.desc()))]


@router.delete("/{platform_id}/invites/{invite_id}", status_code=204)
def revoke_invite(platform_id: UUID, invite_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id, manage=True, lock=True)
    row = db.get(PlatformInvite, invite_id)
    if row is None or row.platform_id != platform_id:
        raise HTTPException(404, "Приглашение не найдено")
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@router.get("/invitation/{token}")
def preview_invitation(token: str, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_limit("platform-invite-preview", str(user.id), 30, 60)
    if len(token) != 43:
        raise HTTPException(404, "Приглашение недоступно")
    invite = db.scalar(select(PlatformInvite).where(PlatformInvite.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if invite is None:
        raise HTTPException(404, "Приглашение недоступно")
    expiry = invite.expires_at
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if invite.revoked_at or (expiry and expiry <= datetime.now(timezone.utc)) or (invite.max_uses is not None and invite.uses >= invite.max_uses):
        raise HTTPException(410, "Приглашение истекло или отключено")
    platform = db.get(Platform, invite.platform_id)
    if platform is None:
        raise HTTPException(404, "Площадка недоступна")
    response.headers["Cache-Control"] = "no-store"
    return {"name": platform.name, "description": platform.description, "icon_url": icon_url(platform)}


@router.post("/join/{token}")
def join(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_limit("platform-join", str(user.id), 30, 60)
    if len(token) != 43:
        raise HTTPException(404, "Приглашение недоступно")
    invite = db.scalar(select(PlatformInvite).where(PlatformInvite.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if invite is None:
        raise HTTPException(404, "Приглашение недоступно")
    platform = db.scalar(select(Platform).where(Platform.id == invite.platform_id).with_for_update())
    if platform is None:
        raise HTTPException(404, "Площадка недоступна")
    db.refresh(invite)
    now = datetime.now(timezone.utc)
    expiry = invite.expires_at
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if invite.revoked_at or (expiry and expiry <= now) or (invite.max_uses is not None and invite.uses >= invite.max_uses):
        raise HTTPException(410, "Приглашение истекло или отключено")
    existing = db.scalar(select(PlatformMember.id).where(PlatformMember.platform_id == platform.id, PlatformMember.user_id == user.id))
    member = add_member(db, platform, user)
    if existing is None:
        invite.uses += 1
    changed(db)
    return summary(platform, member)


@router.get("/{platform_id}/search")
def search_messages(platform_id: UUID, query: str = Query(min_length=1, max_length=120),
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id)
    rows = db.execute(select(Message, Server.name, Server.id, User.username)
        .join(Channel, Channel.id == Message.channel_id).join(Server, Server.id == Channel.server_id)
        .join(User, User.id == Message.author_id)
        .where(Server.platform_id == platform_id, Message.content.icontains(query.strip(), autoescape=True))
        .order_by(Message.created_at.desc(), Message.id.desc()).limit(60)).all()
    return [{"id": message.id, "channel_id": message.channel_id, "chat_id": chat_id,
             "chat_name": name, "author": author, "content": message.content, "created_at": message.created_at}
            for message, name, chat_id, author in rows]


@router.get("/{platform_id}/voice-presence")
async def voice_presence(platform_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    platform_context(db, platform_id, user.id)
    channels = db.execute(select(Channel.id, Server.id).join(Server, Server.id == Channel.server_id)
        .where(Server.platform_id == platform_id, Channel.type == ChannelType.VOICE)).all()
    snapshots = await voice_signaling_manager.snapshot_rooms({str(channel_id) for channel_id, _ in channels})
    return [{"chat_id": chat_id, "count": len(snapshots.get(str(channel_id), []))} for channel_id, chat_id in channels]


@router.delete("/{platform_id}/messages/{message_id}", status_code=204)
async def moderate_message(platform_id: UUID, message_id: UUID,
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.api.routes.messages import _load_message, _build_message_summary
    from app.services.app_events import publish_platform_message_updated
    from app.services.attachment_storage import delete_stored_attachment
    _, actor = platform_context(db, platform_id, user.id, lock=True)
    db.scalar(select(Message).where(Message.id == message_id).with_for_update())
    message = _load_message(db, message_id)
    if message is None or message.channel.server.platform_id != platform_id:
        raise HTTPException(404, "Сообщение недоступно")
    if message.author_id != user.id:
        target = db.scalar(select(PlatformMember).where(
            PlatformMember.platform_id == platform_id, PlatformMember.user_id == message.author_id))
        if target is not None:
            ensure_target_manageable(actor, target)
        elif actor.role not in {MemberRole.OWNER, MemberRole.ADMIN}:
            raise HTTPException(403, "Недостаточно прав")
    paths = [a.storage_path for a in message.attachments if a.storage_path]
    message.attachments.clear()
    message.reactions.clear()
    message.mentions.clear()
    message.content = "Сообщение удалено"
    message.deleted_at = datetime.now(timezone.utc)
    message.edited_at = None
    db.commit()
    for path in paths:
        if db.scalar(select(Attachment.id).where(Attachment.storage_path == path).limit(1)) is None:
            delete_stored_attachment(path)
    payload = _build_message_summary(message, user.id).model_dump(mode="json")
    await publish_platform_message_updated(message.channel.server_id, payload)
    return Response(status_code=204)
