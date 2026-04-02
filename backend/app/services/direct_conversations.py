from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.models import Channel, ChannelType, MemberRole, Server, ServerKind, ServerMember, User


def build_direct_key(left_user_id: UUID, right_user_id: UUID) -> str:
    left, right = sorted([left_user_id.hex, right_user_id.hex])
    return f"{left}:{right}"


def conversation_slug(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def load_direct_conversation(db: Session, left_user_id: UUID, right_user_id: UUID) -> Server | None:
    direct_key = build_direct_key(left_user_id, right_user_id)
    return db.execute(
        select(Server)
        .where(Server.direct_key == direct_key, Server.kind == ServerKind.DIRECT)
        .options(
            selectinload(Server.channels),
            selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalar_one_or_none()


def ensure_direct_conversation(
    db: Session,
    initiator_user: User,
    peer_user: User,
) -> tuple[Server, bool]:
    existing_server = load_direct_conversation(db, initiator_user.id, peer_user.id)
    if existing_server is not None:
        return existing_server, False

    server = Server(
        name=f"{initiator_user.username} / {peer_user.username}",
        slug=conversation_slug("direct"),
        kind=ServerKind.DIRECT,
        direct_key=build_direct_key(initiator_user.id, peer_user.id),
        owner_id=initiator_user.id,
    )
    db.add(server)
    db.flush()

    db.add_all(
        [
            ServerMember(
                server_id=server.id,
                user_id=initiator_user.id,
                role=MemberRole.OWNER,
                nickname=initiator_user.username,
            ),
            ServerMember(
                server_id=server.id,
                user_id=peer_user.id,
                role=MemberRole.MEMBER,
                nickname=peer_user.username,
            ),
            Channel(
                server_id=server.id,
                created_by_id=initiator_user.id,
                name="Личные сообщения",
                topic=None,
                type=ChannelType.TEXT,
                position=0,
            ),
        ]
    )
    db.flush()

    created_server = db.execute(
        select(Server)
        .where(Server.id == server.id)
        .options(
            selectinload(Server.channels),
            selectinload(Server.members).joinedload(ServerMember.user),
        )
    ).scalar_one()
    return created_server, True
