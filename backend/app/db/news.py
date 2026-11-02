"""Public editorial content; drafts and image originals stay behind admin access."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, deferred

from app.db.models import Base


class NewsPost(Base):
    __tablename__ = 'news_posts'

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(160))
    excerpt: Mapped[str] = mapped_column(String(320))
    body: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    has_image: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    image: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    __table_args__ = (Index('ix_news_publication', 'published', 'published_at', 'id'),)
