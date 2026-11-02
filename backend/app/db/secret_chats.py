"""Device-bound E2EE transport. No private encryption keys are stored here."""
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, JSON, LargeBinary, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.models import Base


class SecretDevice(Base):
    __tablename__ = 'secret_devices'
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    auth_session_id: Mapped[UUID] = mapped_column(ForeignKey('auth_sessions.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(80))
    device_keys: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    session_challenge: Mapped[dict | None] = mapped_column(JSON)


class SecretPrekey(Base):
    __tablename__ = 'secret_prekeys'
    device_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'), primary_key=True)
    key_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    claimed: Mapped[bool] = mapped_column(Boolean, default=False)


class SecretChat(Base):
    __tablename__ = 'secret_chats'
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    initiator_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'), index=True)
    recipient_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SecretEnvelope(Base):
    __tablename__ = 'secret_envelopes'
    __table_args__ = (UniqueConstraint('sender_id', 'client_id', name='uq_secret_envelope_client'),)
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    client_id: Mapped[UUID] = mapped_column(Uuid)
    chat_id: Mapped[UUID] = mapped_column(ForeignKey('secret_chats.id', ondelete='CASCADE'), index=True)
    sender_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'))
    recipient_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    ciphertext: Mapped[dict] = mapped_column(JSON)
    digest: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)


class SecretUpload(Base):
    __tablename__ = 'secret_uploads'
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    chat_id: Mapped[UUID] = mapped_column(ForeignKey('secret_chats.id', ondelete='CASCADE'), index=True)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey('secret_devices.id', ondelete='CASCADE'))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    chunk_count: Mapped[int] = mapped_column(BigInteger)
    complete: Mapped[bool] = mapped_column(Boolean, default=False)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MediaCryptoDevice(Base):
    __tablename__ = 'secret_media_devices'
    __table_args__ = (UniqueConstraint('room','identity',name='uq_secret_media_identity'),)
    id: Mapped[UUID] = mapped_column(Uuid,primary_key=True)
    room: Mapped[str] = mapped_column(String(100),index=True)
    identity: Mapped[str] = mapped_column(String(36))
    keys: Mapped[dict] = mapped_column(JSON)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),server_default=func.now(),index=True)


class MediaCryptoPrekey(Base):
    __tablename__ = 'secret_media_prekeys'
    device_id: Mapped[UUID] = mapped_column(ForeignKey('secret_media_devices.id',ondelete='CASCADE'),primary_key=True)
    key_id: Mapped[str] = mapped_column(String(128),primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    claimed: Mapped[bool] = mapped_column(Boolean,default=False)


class MediaCryptoEnvelope(Base):
    __tablename__ = 'secret_media_envelopes'
    __table_args__ = (UniqueConstraint('sender_id','client_id',name='uq_secret_media_envelope'),)
    sequence: Mapped[int] = mapped_column(BigInteger,primary_key=True,autoincrement=True)
    sender_id: Mapped[UUID] = mapped_column(ForeignKey('secret_media_devices.id',ondelete='CASCADE'),index=True)
    recipient_id: Mapped[UUID] = mapped_column(ForeignKey('secret_media_devices.id',ondelete='CASCADE'),index=True)
    client_id: Mapped[UUID] = mapped_column(Uuid)
    ciphertext: Mapped[dict] = mapped_column(JSON)
    digest: Mapped[str] = mapped_column(String(64))
    acknowledged: Mapped[bool] = mapped_column(Boolean,default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),server_default=func.now())
