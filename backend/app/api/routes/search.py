from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import Channel, Server, ServerBlock, ServerKind, ServerMember, User
from app.db.session import get_db
from app.schemas.workspace import WorkspaceChannelSearchSummary
from app.services.workspace_events import list_server_channels_for_user

router = APIRouter(prefix="/search", tags=["search"])

SEARCH_CHANNEL_LIMIT = 60


def _normalize_search_terms(query: str) -> list[str]:
    return [part.casefold() for part in query.strip().split() if part]


def _matches_search_terms(terms: list[str], values: list[str | None]) -> bool:
    if not terms:
        return False

    haystack = " ".join(value.casefold() for value in values if value)
    return all(term in haystack for term in terms)


@router.get("/channels", response_model=list[WorkspaceChannelSearchSummary])
def search_workspace_channels(
    query: str = Query(min_length=1, max_length=120),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WorkspaceChannelSearchSummary]:
    terms = _normalize_search_terms(query)
    if not terms:
        return []

    # Filter candidates before loading per-channel unread counters and voice permissions.
    searchable = func.lower(func.concat_ws(" ", Server.name, Server.description, Channel.name, Channel.topic, cast(Channel.type, String)))
    candidates = db.execute(
        select(Server, Channel.id)
        .join(Channel, Channel.server_id == Server.id)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(
            Server.kind == ServerKind.WORKSPACE,
            ServerMember.user_id == current_user.id,
            ~select(ServerBlock.id).where(ServerBlock.server_id == Server.id, ServerBlock.user_id == current_user.id).exists(),
            *(searchable.contains(term, autoescape=True) for term in terms),
        )
        .order_by(Server.name)
    ).all()
    by_server = {}
    for server, channel_id in candidates:
        by_server.setdefault(server.id, (server, []))[1].append(channel_id)

    results: list[WorkspaceChannelSearchSummary] = []
    for server, channel_ids in by_server.values():
        visible_channels = list_server_channels_for_user(db, server.id, current_user.id, channel_ids=channel_ids)
        for channel in visible_channels:
            if not _matches_search_terms(
                terms,
                [
                    server.name,
                    server.description,
                    channel.name,
                    channel.topic,
                    channel.type,
                ],
            ):
                continue

            results.append(
                WorkspaceChannelSearchSummary(
                    channel_id=channel.id,
                    server_id=server.id,
                    server_name=server.name,
                    server_icon_asset=server.icon_asset,
                    server_icon_updated_at=server.icon_updated_at,
                    name=channel.name,
                    topic=channel.topic,
                    type=channel.type,
                    position=channel.position,
                    unread_count=channel.unread_count,
                    mention_unread_count=channel.mention_unread_count,
                )
            )

    results.sort(
        key=lambda item: (
            -item.mention_unread_count,
            -item.unread_count,
            item.server_name.casefold(),
            item.position,
            item.name.casefold(),
        )
    )
    return results[:SEARCH_CHANNEL_LIMIT]
