import uuid
from datetime import datetime
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.models import Base


class InventoryCatalog(Base):
    __tablename__ = 'inventory_catalog'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("kind IN ('avatar', 'frame', 'wallpaper')", name='ck_catalog_kind'),
                     Index('ix_catalog_kind_created', 'kind', 'created_at', 'id'))


class InventoryItem(Base):
    __tablename__ = 'inventory_items'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    catalog_id: Mapped[str] = mapped_column(String(64), ForeignKey('inventory_catalog.id', name='fk_inventory_catalog'), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), index=True)
    equipped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index('uq_inventory_equipped', 'owner_id', 'kind', unique=True,
                           postgresql_where=text('equipped AND NOT revoked')),)


class InventoryEvent(Base):
    __tablename__ = 'inventory_events'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('inventory_items.id'), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
