from datetime import date, datetime
from uuid import UUID
from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.models import Base


class AnalyticsVisitor(Base):
    __tablename__ = 'analytics_visitors'
    subject: Mapped[str] = mapped_column(String(66), primary_key=True)
    user_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class AnalyticsDay(Base):
    __tablename__ = 'analytics_days'
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    subject: Mapped[str] = mapped_column(String(66), primary_key=True)
    user_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    visits: Mapped[int] = mapped_column(Integer, default=0)
    actions: Mapped[int] = mapped_column(Integer, default=0)
    voice_seconds: Mapped[int] = mapped_column(Integer, default=0)
    voice_sessions: Mapped[int] = mapped_column(Integer, default=0)


class ResourceSample(Base):
    __tablename__ = 'resource_samples'
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class AnalyticsSetting(Base):
    __tablename__ = 'analytics_settings'
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(100))
