"""Platform lifecycle. Callers commit once after the complete mutation.

Every membership/chat mutation locks the parent row, so a simultaneous join and
chat creation cannot leave a participant without access to one of the chats.
"""
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Channel, ChannelType, MemberRole, Platform, PlatformMember, Server,
    ServerKind, ServerMember, User, VoiceAccessRole, VoiceChannelAccess,
)
from app.services.group_chat_defaults import ensure_group_chat_defaults


def platform_context(db: Session, platform_id: UUID, user_id: UUID, *, manage=False, owner=False, lock=False):
    query = select(Platform).where(Platform.id == platform_id)
    if lock:
        query = query.with_for_update()
    platform = db.scalar(query)
    member = db.scalar(select(PlatformMember).where(
        PlatformMember.platform_id == platform_id, PlatformMember.user_id == user_id))
    if platform is None or member is None:
        raise HTTPException(404, "Площадка недоступна")
    if owner and member.role != MemberRole.OWNER:
        raise HTTPException(403, "Действие доступно только владельцу площадки")
    if manage and member.role not in {MemberRole.OWNER, MemberRole.ADMIN}:
        raise HTTPException(403, "Недостаточно прав для управления площадкой")
    return platform, member


def ensure_target_manageable(actor: PlatformMember, target: PlatformMember):
    if target.role == MemberRole.OWNER or actor.user_id == target.user_id:
        raise HTTPException(403, "Нельзя выполнить это действие над владельцем или собой")
    if actor.role == MemberRole.MEMBER or (actor.role == MemberRole.ADMIN and target.role != MemberRole.MEMBER):
        raise HTTPException(403, "Администратор может управлять только пользователями")


def reject_individual_chat_management(server: Server):
    if server.platform_id is not None:
        raise HTTPException(409, "Участники и настройки этого чата управляются через площадку")


def platform_chats(db: Session, platform_id: UUID):
    return db.scalars(select(Server).where(Server.platform_id == platform_id)
                      .order_by(Server.platform_position, Server.id)).all()


def create_chat(db: Session, platform: Platform, name: str) -> Server:
    position = db.scalar(select(func.max(Server.platform_position)).where(Server.platform_id == platform.id))
    chat = Server(name=name, slug=f"platform-chat-{uuid4().hex}", kind=ServerKind.GROUP_CHAT,
                  platform_id=platform.id, platform_position=(position + 1 if position is not None else 0),
                  owner_id=platform.owner_id)
    db.add(chat)
    db.flush()
    for member in db.scalars(select(PlatformMember).where(PlatformMember.platform_id == platform.id)):
        db.add(ServerMember(server_id=chat.id, user_id=member.user_id, role=member.role))
    db.flush()
    ensure_group_chat_defaults(db, chat)
    return chat


def add_member(db: Session, platform: Platform, user: User) -> PlatformMember:
    # The caller holds the parent lock, including when joining through an invite.
    member = db.scalar(select(PlatformMember).where(
        PlatformMember.platform_id == platform.id, PlatformMember.user_id == user.id))
    if member is not None:
        return member
    member = PlatformMember(platform_id=platform.id, user_id=user.id, role=MemberRole.MEMBER)
    db.add(member)
    for chat in platform_chats(db, platform.id):
        db.add(ServerMember(server_id=chat.id, user_id=user.id, role=MemberRole.MEMBER))
        for channel_id in db.scalars(select(Channel.id).where(Channel.server_id == chat.id, Channel.type == ChannelType.VOICE)):
            db.add(VoiceChannelAccess(channel_id=channel_id, user_id=user.id, role=VoiceAccessRole.RESIDENT))
    db.flush()
    return member


def set_member_role(db: Session, platform: Platform, member: PlatformMember, role: MemberRole):
    member.role = role
    chat_ids = select(Server.id).where(Server.platform_id == platform.id)
    for copy in db.scalars(select(ServerMember).where(ServerMember.server_id.in_(chat_ids), ServerMember.user_id == member.user_id)):
        copy.role = role
    voice_ids = select(Channel.id).where(Channel.server_id.in_(chat_ids), Channel.type == ChannelType.VOICE)
    for access in db.scalars(select(VoiceChannelAccess).where(VoiceChannelAccess.channel_id.in_(voice_ids), VoiceChannelAccess.user_id == member.user_id)):
        access.role = VoiceAccessRole.OWNER if role == MemberRole.OWNER else VoiceAccessRole.RESIDENT


def remove_member(db: Session, platform: Platform, member: PlatformMember) -> list[UUID]:
    chat_ids = select(Server.id).where(Server.platform_id == platform.id)
    voice_ids = list(db.scalars(select(Channel.id).where(Channel.server_id.in_(chat_ids), Channel.type == ChannelType.VOICE)))
    db.execute(delete(VoiceChannelAccess).where(VoiceChannelAccess.channel_id.in_(voice_ids), VoiceChannelAccess.user_id == member.user_id))
    db.execute(delete(ServerMember).where(ServerMember.server_id.in_(chat_ids), ServerMember.user_id == member.user_id))
    db.delete(member)
    db.flush()
    return voice_ids
