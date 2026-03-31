from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, LargeBinary, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column, relationship


class Base(DeclarativeBase):
    pass


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


class VoiceAccessRole(str, enum.Enum):
    OWNER = "owner"
    RESIDENT = "resident"
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

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    public_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    avatar_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avatar_content: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    owned_servers: Mapped[list["Server"]] = relationship(back_populates="owner")
    memberships: Mapped[list["ServerMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(back_populates="author", cascade="all, delete-orphan")
    message_reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    created_channels: Mapped[list["Channel"]] = relationship(back_populates="created_by")
    voice_permissions: Mapped[list["VoiceChannelAccess"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    requested_voice_joins: Mapped[list["VoiceJoinRequest"]] = relationship(
        back_populates="requester",
        cascade="all, delete-orphan",
    )


class Server(TimestampMixin, Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_asset: Mapped[str | None] = mapped_column(String(255), nullable=True)
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
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    server: Mapped["Server"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")


class Message(TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_channel_created_at", "channel_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reply_to_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
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
    reaction: Mapped[MessageReactionKind] = mapped_column(
        Enum(MessageReactionKind, name="messagereactionkind", values_callable=enum_values),
        nullable=False,
    )

    message: Mapped["Message"] = relationship(back_populates="reactions")
    user: Mapped["User"] = relationship(back_populates="message_reactions")


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
