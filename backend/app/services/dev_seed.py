from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.models import Channel, ChannelType, MemberRole, Message, MessageType, Server, ServerMember, User
from app.db.session import SessionLocal
from app.services.default_tavern import ensure_default_tavern_access_for_users, ensure_default_tavern_channel
from app.services.voice_access import ensure_voice_channel_owner_permission


def _slugify(value: str) -> str:
    slug = re.sub(r"[\W_]+", "-", value.casefold(), flags=re.UNICODE).strip("-")
    return slug or "group"


def ensure_development_seed_data() -> None:
    settings = get_settings()
    if settings.environment != "development" or not settings.seed_demo_data:
        return

    with SessionLocal() as db:
        user = db.execute(
            select(User).where(
                or_(
                    User.email == settings.demo_login.lower(),
                    User.username == settings.demo_nick,
                    User.email == "were9000",
                    User.email == "demo@tescord.local",
                )
            )
        ).scalar_one_or_none()

        if user is None:
            user = User(
                email=settings.demo_login.lower(),
                username=settings.demo_nick,
                display_name=settings.demo_full_name,
                password_hash=hash_password(settings.demo_password),
                bio=settings.demo_character_name,
                is_admin=settings.demo_is_admin,
            )
            db.add(user)
            db.flush()
        else:
            user.email = settings.demo_login.lower()
            user.username = settings.demo_nick
            user.display_name = settings.demo_full_name
            user.bio = settings.demo_character_name
            user.is_admin = settings.demo_is_admin
            if not verify_password(settings.demo_password, user.password_hash):
                user.password_hash = hash_password(settings.demo_password)

        server_slug = _slugify(settings.demo_server_name)
        server = db.execute(select(Server).where(Server.slug == server_slug)).scalar_one_or_none()
        if server is None:
            server = Server(
                name=settings.demo_server_name,
                slug=server_slug,
                description="Базовая группа для первого MVP Tescord",
                owner_id=user.id,
            )
            db.add(server)
            db.flush()
        else:
            server.owner_id = user.id
            server.description = "Базовая группа для первого MVP Tescord"

        membership = db.execute(
            select(ServerMember).where(
                ServerMember.server_id == server.id,
                ServerMember.user_id == user.id,
            )
        ).scalar_one_or_none()

        if membership is None:
            db.add(
                ServerMember(
                    server_id=server.id,
                    user_id=user.id,
                    role=MemberRole.OWNER,
                    nickname="Администратор",
                )
            )
        else:
            membership.role = MemberRole.OWNER
            membership.nickname = "Администратор"

        channels = [
            ("объявления", "Важные новости и обновления", 0, ChannelType.TEXT),
            ("правила", "Основные правила группы", 1, ChannelType.TEXT),
            ("разработка", "Обсуждение задач и планов", 2, ChannelType.TEXT),
            ("backend", "API, база данных и FastAPI", 3, ChannelType.TEXT),
            ("frontend", "Angular интерфейс и UX", 4, ChannelType.TEXT),
            ("голосовой штаб", "Основная голосовая комната для группы", 5, ChannelType.VOICE),
        ]

        existing_channels = {
            channel.name: channel
            for channel in db.execute(select(Channel).where(Channel.server_id == server.id)).scalars().all()
        }

        for legacy_name in {"welcome", "rules", "roadmap", "design-room"}:
            legacy_channel = existing_channels.get(legacy_name)
            if legacy_channel is not None:
                db.delete(legacy_channel)
                existing_channels.pop(legacy_name, None)

        for name, topic, position, channel_type in channels:
            channel = existing_channels.get(name)
            if channel is None:
                db.add(
                    Channel(
                        server_id=server.id,
                        created_by_id=user.id,
                        name=name,
                        topic=topic,
                        type=channel_type,
                        position=position,
                    )
                )
            else:
                channel.topic = topic
                channel.position = position
                channel.type = channel_type

        db.flush()

        tavern_channel = ensure_default_tavern_channel(db, server, created_by_id=user.id)
        ensure_default_tavern_access_for_users(db, [tavern_channel], [user])

        for channel in db.execute(
            select(Channel).where(Channel.server_id == server.id, Channel.type == ChannelType.VOICE)
        ).scalars():
            if not channel.is_default_tavern:
                ensure_voice_channel_owner_permission(db, channel)

        seeded_channels = {
            channel.name: channel
            for channel in db.execute(select(Channel).where(Channel.server_id == server.id)).scalars().all()
        }
        announcements_channel = seeded_channels.get("объявления")
        if announcements_channel is not None:
            has_messages = db.execute(
                select(Message.id).where(Message.channel_id == announcements_channel.id).limit(1)
            ).scalar_one_or_none()

            if has_messages is None:
                start_at = datetime.now(UTC) - timedelta(hours=6)
                for index in range(1, 41):
                    created_at = start_at + timedelta(minutes=index * 7)
                    db.add(
                        Message(
                            channel_id=announcements_channel.id,
                            author_id=user.id,
                            content=(
                                f"Запись {index}. Tescord уже умеет авторизацию, группы, каналы и голос. "
                                "Следующий шаг для MVP — настоящий текстовый чат с вложениями и ленивой загрузкой истории."
                            ),
                            type=MessageType.TEXT,
                            created_at=created_at,
                            updated_at=created_at,
                        )
                    )

        db.commit()
