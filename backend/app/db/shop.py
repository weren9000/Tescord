"""Store offers, immutable purchase receipts and administration audit."""
import uuid
from datetime import datetime
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Integer, JSON, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.models import Base


class ShopOffer(Base):
    __tablename__ = 'shop_offers'
    catalog_id: Mapped[str] = mapped_column(ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True)
    price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='draft')
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rarity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    recommended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (CheckConstraint("price BETWEEN 1 AND 1000000000 AND status IN ('draft','published','withdrawn')", name='ck_shop_offer'),)


class ShopPurchase(Base):
    __tablename__ = 'shop_purchases'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), index=True)
    buyer_name: Mapped[str] = mapped_column(String(32), nullable=False)
    catalog_id: Mapped[str] = mapped_column(String(64), nullable=False)
    item_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('inventory_items.id', ondelete='SET NULL'))
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    offer_version: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    __table_args__ = (CheckConstraint('price > 0 AND balance_after >= 0', name='ck_shop_purchase'),)


class ShopAudit(Base):
    __tablename__ = 'shop_audit'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    actor_name: Mapped[str] = mapped_column(String(32), nullable=False)
    target: Mapped[str] = mapped_column(String(64), nullable=False)
    before: Mapped[dict] = mapped_column(JSON, nullable=False)
    after: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShopFavorite(Base):
    __tablename__ = 'shop_favorites'
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    catalog_id: Mapped[str] = mapped_column(ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True)


class ShopCollection(Base):
    __tablename__ = 'shop_collections'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(String(180), nullable=False, default='')
    artwork: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cover_id: Mapped[str] = mapped_column(ForeignKey('inventory_catalog.id', ondelete='CASCADE'))
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ShopCollectionItem(Base):
    __tablename__ = 'shop_collection_items'
    collection_id: Mapped[str] = mapped_column(ForeignKey('shop_collections.id', ondelete='CASCADE'), primary_key=True)
    catalog_id: Mapped[str] = mapped_column(ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True)
