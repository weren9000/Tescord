from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, CheckConstraint, Boolean, DateTime, Enum, ForeignKey, Index, Integer, LargeBinary, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column, relationship
from app.services.avatar_presets import random_avatar_preset


class Base(DeclarativeBase):
    pass


class WalletBatch(Base):
    __tablename__ = 'wallet_batches'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class ChannelType(str, enum.Enum):
    TEXT = "text"
    VOICE = "voice"
    ANNOUNCEMENT = "announcement"


class MemberRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class ServerKind(str, enum.Enum):
    WORKSPACE = "workspace"
    DIRECT = "direct"
    GROUP_CHAT = "group_chat"


class FriendRequestStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class VoiceAccessRole(str, enum.Enum):
    OWNER = "owner"
    RESIDENT = "resident"
    GUEST = "guest"
    STRANGER = "stranger"


class VoiceJoinRequestStatus(str, enum.Enum):
    PENDING = "pending"
    ALLOWED = "allowed"
    RESIDENT = "resident"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class MessageType(str, enum.Enum):
    TEXT = "text"
    SYSTEM = "system"


class MessageReactionKind(str, enum.Enum):
    HEART = "heart"
    LIKE = "like"
    DISLIKE = "dislike"
    ANGRY = "angry"
    CRY = "cry"
    CONFUSED = "confused"
    DISPLEASED = "displeased"
    LAUGH = "laugh"
    FIRE = "fire"
    WOW = "wow"
    PRAYING_CAT = "praying_cat"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint('coins >= 0 AND coins <= 9000000000000 AND crystals >= 0 AND crystals <= 9000000000000', name='ck_user_wallet_bounds'),)
    coins: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')
    crystals: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    friend_invite_code: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)
    friend_invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    chat_wallpaper: Mapped[str | None] = mapped_column(String(64))
    personal_wallpaper: Mapped[str | None] = mapped_column(String(36))
    wallpaper_scale: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default='100')
    wallpaper_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=35, server_default='35')
    public_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_preset: Mapped[str] = mapped_column(String(32), nullable=False, default=random_avatar_preset, server_default="frog")
    avatar_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    avatar_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avatar_content: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    is_shop_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    is_avatar_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    owned_servers: Mapped[list["Server"]] = relationship(back_populates="owner", passive_deletes=True)
    memberships: Mapped[list["ServerMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(back_populates="author", cascade="all, delete-orphan")
    message_reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    message_mentions: Mapped[list["MessageMention"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    created_channels: Mapped[list["Channel"]] = relationship(back_populates="created_by", passive_deletes=True)
    voice_permissions: Mapped[list["VoiceChannelAccess"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    requested_voice_joins: Mapped[list["VoiceJoinRequest"]] = relationship(
        back_populates="requester",
        cascade="all, delete-orphan",
    )
    sent_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        foreign_keys="FriendRequest.requester_user_id",
        back_populates="requester",
        cascade="all, delete-orphan",
    )
    received_friend_requests: Mapped[list["FriendRequest"]] = relationship(
        foreign_keys="FriendRequest.target_user_id",
        back_populates="target",
        cascade="all, delete-orphan",
    )
    sent_friend_blocks: Mapped[list["FriendBlock"]] = relationship(
        foreign_keys="FriendBlock.blocker_user_id",
        back_populates="blocker",
        cascade="all, delete-orphan",
    )
    received_friend_blocks: Mapped[list["FriendBlock"]] = relationship(
        foreign_keys="FriendBlock.blocked_user_id",
        back_populates="blocked",
        cascade="all, delete-orphan",
    )
    server_blocks: Mapped[list["ServerBlock"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    push_subscriptions: Mapped[list["PushSubscription"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    conversation_push_settings: Mapped[list["ConversationPushSetting"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class PlatformMigrationState(Base):
    __tablename__ = "platform_migration_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    retired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Platform(TimestampMixin, Base):
    """A community whose chats share one membership and role policy."""

    __tablename__ = "platforms"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    members: Mapped[list["PlatformMember"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    chats: Mapped[list["Server"]] = relationship(back_populates="platform", cascade="all, delete-orphan", passive_deletes=True)


class PlatformMember(Base):
    __tablename__ = "platform_members"
    __table_args__ = (UniqueConstraint("platform_id", "user_id", name="uq_platform_member"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    platform_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[MemberRole] = mapped_column(Enum(MemberRole, name="memberrole", values_callable=enum_values), nullable=False, default=MemberRole.MEMBER)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PlatformInvite(Base):
    __tablename__ = "platform_invites"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    platform_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class Server(TimestampMixin, Base):
    chat_wallpaper: Mapped[str | None] = mapped_column(String(64))
    wallpaper_scale: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default='100')
    wallpaper_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=35, server_default='35')
    __tablename__ = "servers"

    platform_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("platforms.id", ondelete="CASCADE"), index=True)
    platform_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    platform: Mapped["Platform | None"] = relationship(back_populates="chats")

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_asset: Mapped[str | None] = mapped_column(String(255), nullable=True)
    icon_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    icon_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    icon_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    icon_content: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    icon_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kind: Mapped[ServerKind] = mapped_column(
        Enum(ServerKind, name="serverkind", values_callable=enum_values),
        default=ServerKind.WORKSPACE,
        nullable=False,
        server_default=ServerKind.WORKSPACE.value,
    )
    direct_key: Mapped[str | None] = mapped_column(String(72), unique=True, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    owner: Mapped["User"] = relationship(back_populates="owned_servers")
    channels: Mapped[list["Channel"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    members: Mapped[list["ServerMember"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    blocks: Mapped[list["ServerBlock"]] = relationship(back_populates="server", cascade="all, delete-orphan")
    push_settings: Mapped[list["ConversationPushSetting"]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
    )


class Channel(TimestampMixin, Base):
    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("server_id", "name", name="uq_channels_server_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    topic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type: Mapped[ChannelType] = mapped_column(
        Enum(ChannelType, name="channeltype", values_callable=enum_values),
        default=ChannelType.TEXT,
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_default_tavern: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    server: Mapped["Server"] = relationship(back_populates="channels")
    created_by: Mapped["User"] = relationship(back_populates="created_channels")
    messages: Mapped[list["Message"]] = relationship(back_populates="channel", cascade="all, delete-orphan")
    voice_permissions: Mapped[list["VoiceChannelAccess"]] = relationship(
        back_populates="channel",
        cascade="all, delete-orphan",
    )
    voice_join_requests: Mapped[list["VoiceJoinRequest"]] = relationship(
        back_populates="channel",
        cascade="all, delete-orphan",
    )


class ServerInvite(Base):
    __tablename__ = "server_invites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), index=True, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FriendSpaceInvite(Base):
    __tablename__ = "friend_space_invites"
    __table_args__ = (UniqueConstraint("server_id", "target_user_id", name="uq_friend_space_invite_target"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    sender_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ServerMember(Base):
    __tablename__ = "server_members"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_members_server_user"),
        Index("ix_server_members_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[MemberRole] = mapped_column(
        Enum(MemberRole, name="memberrole", values_callable=enum_values),
        default=MemberRole.MEMBER,
        nullable=False,
    )
    nickname: Mapped[str | None] = mapped_column(String(64), nullable=True)
    conversation_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    wallpaper_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    chat_wallpaper: Mapped[str | None] = mapped_column(String(64))
    wallpaper_scale: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default='100')
    wallpaper_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=35, server_default='35')
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    server: Mapped["Server"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")


class FriendRequest(TimestampMixin, Base):
    __tablename__ = "friend_requests"
    __table_args__ = (
        UniqueConstraint("requester_user_id", "target_user_id", name="uq_friend_requests_requester_target"),
        Index("ix_friend_requests_target_status", "target_user_id", "status"),
        Index("ix_friend_requests_requester_status", "requester_user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    requester_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[FriendRequestStatus] = mapped_column(
        Enum(FriendRequestStatus, name="friendrequeststatus", values_callable=enum_values),
        default=FriendRequestStatus.PENDING,
        nullable=False,
        server_default=FriendRequestStatus.PENDING.value,
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    requester: Mapped["User"] = relationship(
        foreign_keys=[requester_user_id],
        back_populates="sent_friend_requests",
    )
    target: Mapped["User"] = relationship(
        foreign_keys=[target_user_id],
        back_populates="received_friend_requests",
    )


class WalletOperation(TimestampMixin, Base):
    __tablename__ = 'wallet_operations'
    __table_args__ = (
        CheckConstraint("currency IN ('coins', 'crystals') AND delta != 0 AND balance_after >= 0", name='ck_wallet_operation'),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    actor_name: Mapped[str] = mapped_column(String(32))
    currency: Mapped[str] = mapped_column(String(16))
    delta: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    reason: Mapped[str] = mapped_column(String(240))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('wallet_batches.id', ondelete='SET NULL'), index=True)


class FriendNotice(TimestampMixin, Base):
    __tablename__ = "friend_notices"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    peer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(16))


class FriendBlock(TimestampMixin, Base):
    __tablename__ = "friend_blocks"
    __table_args__ = (
        UniqueConstraint("blocker_user_id", "blocked_user_id", name="uq_friend_blocks_blocker_blocked"),
        Index("ix_friend_blocks_blocked_user_id", "blocked_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    blocker_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    blocked_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    blocker: Mapped["User"] = relationship(
        foreign_keys=[blocker_user_id],
        back_populates="sent_friend_blocks",
    )
    blocked: Mapped["User"] = relationship(
        foreign_keys=[blocked_user_id],
        back_populates="received_friend_blocks",
    )


class ServerBlock(TimestampMixin, Base):
    __tablename__ = "server_blocks"
    __table_args__ = (
        UniqueConstraint("server_id", "user_id", name="uq_server_blocks_server_user"),
        Index("ix_server_blocks_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    server: Mapped["Server"] = relationship(back_populates="blocks")
    user: Mapped["User"] = relationship(back_populates="server_blocks")


class PushSubscription(TimestampMixin, Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="push_subscriptions")


class ConversationPushSetting(Base):
    __tablename__ = "conversation_push_settings"
    __table_args__ = (
        UniqueConstraint("user_id", "server_id", name="uq_conversation_push_settings_user_server"),
        Index("ix_conversation_push_settings_server_id", "server_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="conversation_push_settings")
    server: Mapped["Server"] = relationship(back_populates="push_settings")


class Message(TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_channel_created_at", "channel_id", "created_at"),
                      UniqueConstraint("author_id", "client_message_id", name="uq_messages_author_client"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reply_to_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    client_message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[MessageType] = mapped_column(
        Enum(MessageType, name="messagetype", values_callable=enum_values),
        default=MessageType.TEXT,
        nullable=False,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    channel: Mapped["Channel"] = relationship(back_populates="messages")
    author: Mapped["User"] = relationship(back_populates="messages")
    reply_to: Mapped["Message | None"] = relationship(
        remote_side="Message.id",
        back_populates="replies",
    )
    replies: Mapped[list["Message"]] = relationship(back_populates="reply_to")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )
    mentions: Mapped[list["MessageMention"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )
    read_states: Mapped[list["ChannelReadState"]] = relationship(
        back_populates="last_read_message",
    )


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (Index("ix_attachments_message_id", "message_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    message: Mapped["Message"] = relationship(back_populates="attachments")


class MessageReaction(TimestampMixin, Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "reaction", name="uq_message_reactions_message_user_reaction"),
        Index("ix_message_reactions_message_reaction", "message_id", "reaction"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reaction: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    message: Mapped["Message"] = relationship(back_populates="reactions")
    user: Mapped["User"] = relationship(back_populates="message_reactions")


class MessageMention(Base):
    __tablename__ = "message_mentions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_message_mentions_message_user"),
        Index("ix_message_mentions_user_id", "user_id"),
        Index("ix_message_mentions_message_id", "message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    message: Mapped["Message"] = relationship(back_populates="mentions")
    user: Mapped["User"] = relationship(back_populates="message_mentions")


class ChannelReadState(Base):
    __tablename__ = "channel_read_states"
    __table_args__ = (
        UniqueConstraint("channel_id", "user_id", name="uq_channel_read_states_channel_user"),
        Index("ix_channel_read_states_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    channel: Mapped["Channel"] = relationship()
    user: Mapped["User"] = relationship()
    last_read_message: Mapped["Message | None"] = relationship(back_populates="read_states")


class VoiceChannelAccess(TimestampMixin, Base):
    __tablename__ = "voice_channel_access"
    __table_args__ = (
        UniqueConstraint("channel_id", "user_id", name="uq_voice_channel_access_channel_user"),
        Index("ix_voice_channel_access_user_role", "user_id", "role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[VoiceAccessRole] = mapped_column(
        Enum(VoiceAccessRole, name="voiceaccessrole", values_callable=enum_values),
        nullable=False,
    )
    owner_muted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    temporary_access_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    channel: Mapped["Channel"] = relationship(back_populates="voice_permissions")
    user: Mapped["User"] = relationship(back_populates="voice_permissions")


class VoiceJoinRequest(TimestampMixin, Base):
    __tablename__ = "voice_join_requests"
    __table_args__ = (
        Index("ix_voice_join_requests_status_created_at", "status", "created_at"),
        Index("ix_voice_join_requests_requester", "requester_user_id", "channel_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    requester_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[VoiceJoinRequestStatus] = mapped_column(
        Enum(VoiceJoinRequestStatus, name="voicejoinrequeststatus", values_callable=enum_values),
        default=VoiceJoinRequestStatus.PENDING,
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    channel: Mapped["Channel"] = relationship(back_populates="voice_join_requests")
    requester: Mapped["User"] = relationship(back_populates="requested_voice_joins")


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), unique=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
