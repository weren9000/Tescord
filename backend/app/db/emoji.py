from datetime import datetime
from uuid import UUID
from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from app.db.models import Base


class EmojiUsage(Base):
    __tablename__ = 'user_emoji_usage'
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(32), primary_key=True)
    uses: Mapped[int] = mapped_column(Integer, nullable=False)
    last_used: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
