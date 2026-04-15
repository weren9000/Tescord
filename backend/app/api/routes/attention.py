from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies.auth import get_current_user
from app.db.models import Message, Server, ServerKind, ServerMember, User
from app.db.session import get_db
from app.schemas.attention import AttentionInbox, AttentionMentionItem
from app.services.workspace_events import list_server_channels_for_user, load_unread_states_by_channel_id

router = APIRouter(prefix="/attention", tags=["attention"])


def _first_text_channel(server: Server):
    text_channels = sorted(
        (channel for channel in server.channels if channel.type.value == "text"),
        key=lambda channel: (channel.position, channel.name.casefold()),
    )
    return text_channels[0] if text_channels else None


def _build_message_preview(message: Message | None) -> str | None:
    if message is None:
        return None

    content = " ".join((message.content or "").split())
    if content:
        return content

    attachments_count = len(message.attachments)
    if attachments_count > 1:
        return f"Attachments: {attachments_count}"
    if attachments_count == 1:
        return "Attachment"

    return "New message"


def _load_last_messages_by_channel_id(db: Session, channel_ids: list[UUID]) -> dict[UUID, Message]:
    if not channel_ids:
        return {}

    latest_message_subquery = (
        select(
            Message.channel_id.label("channel_id"),
            func.max(Message.created_at).label("last_created_at"),
        )
        .where(Message.channel_id.in_(channel_ids))
        .group_by(Message.channel_id)
        .subquery()
    )

    messages = db.execute(
        select(Message)
        .join(
            latest_message_subquery,
            and_(
                Message.channel_id == latest_message_subquery.c.channel_id,
                Message.created_at == latest_message_subquery.c.last_created_at,
            ),
        )
        .options(selectinload(Message.attachments))
        .order_by(Message.channel_id, Message.created_at.desc(), Message.id.desc())
    ).scalars().unique().all()

    last_messages: dict[UUID, Message] = {}
    for message in messages:
        last_messages.setdefault(message.channel_id, message)

    return last_messages


@router.get("/inbox", response_model=AttentionInbox)
def get_attention_inbox(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttentionInbox:
    conversation_memberships = db.execute(
        select(ServerMember)
        .join(Server, Server.id == ServerMember.server_id)
        .where(
            ServerMember.user_id == current_user.id,
            Server.kind == ServerKind.GROUP_CHAT,
        )
        .options(
            joinedload(ServerMember.server).selectinload(Server.channels),
        )
    ).scalars().all()

    conversation_primary_channels = {
        membership.server.id: _first_text_channel(membership.server)
        for membership in conversation_memberships
    }
    conversation_channel_ids = [
        channel.id
        for channel in conversation_primary_channels.values()
        if channel is not None
    ]
    conversation_unread_states = load_unread_states_by_channel_id(db, conversation_channel_ids, current_user.id)

    workspace_servers = db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(Server.kind == ServerKind.WORKSPACE, ServerMember.user_id == current_user.id)
        .order_by(Server.name)
    ).scalars().all()

    workspace_channels_by_server_id = {
        server.id: list_server_channels_for_user(db, server.id, current_user.id)
        for server in workspace_servers
    }
    workspace_channel_ids = [
        channel.id
        for channels in workspace_channels_by_server_id.values()
        for channel in channels
        if channel.mention_unread_count > 0 and channel.first_mention_unread_message_id is not None
    ]

    last_messages_by_channel_id = _load_last_messages_by_channel_id(
        db,
        conversation_channel_ids + workspace_channel_ids,
    )

    mention_items: list[AttentionMentionItem] = []

    for membership in conversation_memberships:
        server = membership.server
        primary_channel = conversation_primary_channels.get(server.id)
        if primary_channel is None:
            continue

        unread_state = conversation_unread_states.get(primary_channel.id)
        if unread_state is None or unread_state.mention_unread_count <= 0 or unread_state.first_mention_unread_message_id is None:
            continue

        last_message = last_messages_by_channel_id.get(primary_channel.id)
        mention_items.append(
            AttentionMentionItem(
                kind="conversation_mention",
                server_id=server.id,
                server_kind="group_chat",
                server_name=server.name,
                channel_id=primary_channel.id,
                channel_name=primary_channel.name,
                icon_asset=server.icon_asset,
                icon_updated_at=server.icon_updated_at,
                unread_count=unread_state.unread_count,
                mention_unread_count=unread_state.mention_unread_count,
                focus_message_id=unread_state.first_mention_unread_message_id,
                preview=_build_message_preview(last_message),
                activity_at=last_message.created_at if last_message is not None else None,
            )
        )

    for server in workspace_servers:
        for channel in workspace_channels_by_server_id.get(server.id, []):
            if channel.mention_unread_count <= 0 or channel.first_mention_unread_message_id is None:
                continue

            last_message = last_messages_by_channel_id.get(channel.id)
            mention_items.append(
                AttentionMentionItem(
                    kind="channel_mention",
                    server_id=server.id,
                    server_kind="workspace",
                    server_name=server.name,
                    channel_id=channel.id,
                    channel_name=channel.name,
                    icon_asset=server.icon_asset,
                    icon_updated_at=server.icon_updated_at,
                    unread_count=channel.unread_count,
                    mention_unread_count=channel.mention_unread_count,
                    focus_message_id=channel.first_mention_unread_message_id,
                    preview=_build_message_preview(last_message),
                    activity_at=last_message.created_at if last_message is not None else None,
                )
            )

    mention_items.sort(
        key=lambda item: (
            item.activity_at is not None,
            item.activity_at,
        ),
        reverse=True,
    )

    return AttentionInbox(mentions=mention_items)
