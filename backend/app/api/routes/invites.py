from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import MemberRole, Server, ServerInvite, ServerKind, ServerMember, User
from app.db.session import get_db
from app.services.app_events import publish_members_updated_from_sync, publish_servers_changed_from_sync
from app.services.group_chat_defaults import ensure_group_chat_defaults
from app.services.platforms import reject_individual_chat_management
from app.services.workspace_defaults import ensure_workspace_defaults
from app.services.server_access import get_accessible_server, get_membership, is_server_blocked
from app.services.rate_limits import enforce_limit

router = APIRouter(tags=["invites"])


class CreateInvite(BaseModel):
    expires_in_days: Literal[1, 7, 30] | None = 7
    max_uses: int | None = Field(default=None, ge=1, le=10000)


def managed_server(db: Session, server_id: UUID, user: User) -> Server:
    server, member = get_accessible_server(db, server_id, user)
    reject_individual_chat_management(server)
    if server.kind not in {ServerKind.WORKSPACE, ServerKind.GROUP_CHAT}:
        raise HTTPException(400, "Для личной беседы нельзя создать приглашение")
    if not user.is_admin and (member is None or member.role not in {MemberRole.OWNER, MemberRole.ADMIN}):
        raise HTTPException(403, "Недостаточно прав для управления приглашениями")
    return server


def invite_state(invite: ServerInvite) -> str:
    if invite.revoked_at:
        return "revoked"
    expiry = invite.expires_at
    if expiry and (expiry if expiry.tzinfo else expiry.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
        return "expired"
    if invite.max_uses is not None and invite.uses >= invite.max_uses:
        return "exhausted"
    return "active"


def ensure_active(invite: ServerInvite):
    messages = {"revoked": "Приглашение отключено", "expired": "Срок приглашения истёк", "exhausted": "Лимит приглашения исчерпан"}
    state = invite_state(invite)
    if state != "active":
        raise HTTPException(410, messages[state])


def summary(db: Session, invite: ServerInvite):
    creator = db.get(User, invite.created_by_id) if invite.created_by_id else None
    return {"id": invite.id, "created_by": creator.username if creator else "Удалённый пользователь",
            "created_at": invite.created_at, "expires_at": invite.expires_at,
            "max_uses": invite.max_uses, "uses": invite.uses, "state": invite_state(invite)}


def lookup(db: Session, token: str) -> ServerInvite:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise HTTPException(404, "Приглашение не найдено")
    invite = db.scalar(select(ServerInvite).where(ServerInvite.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if invite is None:
        raise HTTPException(404, "Приглашение не найдено")
    return invite


@router.post("/servers/{server_id}/invites", status_code=201)
def create_invite(server_id: UUID, payload: CreateInvite, response: Response,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    managed_server(db, server_id, user)
    enforce_limit("invite-create", str(user.id), 30, 3600)
    token = secrets.token_urlsafe(32)
    invite = ServerInvite(server_id=server_id, created_by_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                          expires_at=datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days) if payload.expires_in_days else None,
                          max_uses=payload.max_uses)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    response.headers["Cache-Control"] = "no-store"
    return {**summary(db, invite), "token": token}


@router.get("/servers/{server_id}/invites")
def list_invites(server_id: UUID, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    managed_server(db, server_id, user)
    response.headers["Cache-Control"] = "no-store"
    rows = db.scalars(select(ServerInvite).where(ServerInvite.server_id == server_id).order_by(ServerInvite.created_at.desc())).all()
    return [summary(db, row) for row in rows]


@router.delete("/servers/{server_id}/invites/{invite_id}", status_code=204)
def revoke_invite(server_id: UUID, invite_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    managed_server(db, server_id, user)
    db.scalar(select(Server).where(Server.id == server_id).with_for_update())
    invite = db.scalar(select(ServerInvite).where(ServerInvite.id == invite_id, ServerInvite.server_id == server_id).with_for_update())
    if invite is None:
        raise HTTPException(404, "Приглашение не найдено")
    invite.revoked_at = invite.revoked_at or datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@router.get("/invites/{token}")
def preview_invite(token: str, request: Request, response: Response, db: Session = Depends(get_db)):
    enforce_limit("invite-preview", request.client.host if request.client else "unknown", 120, 60)
    invite = lookup(db, token)
    ensure_active(invite)
    server = db.get(Server, invite.server_id)
    if server is None or server.kind not in {ServerKind.WORKSPACE, ServerKind.GROUP_CHAT}:
        raise HTTPException(404, "Сообщество не найдено")
    response.headers["Cache-Control"] = "no-store"
    return {"server_id": server.id, "name": server.name, "kind": server.kind.value,
            "icon_asset": server.icon_asset, "icon_updated_at": server.icon_updated_at}


@router.post("/invites/{token}/join")
def join_invite(token: str, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_limit("invite-join", str(user.id), 30, 60)
    initial = lookup(db, token)
    # One lock for all ways of adding members, including different invite links.
    server = db.scalar(select(Server).where(Server.id == initial.server_id).with_for_update())
    if server is None or server.kind not in {ServerKind.WORKSPACE, ServerKind.GROUP_CHAT}:
        raise HTTPException(404, "Сообщество не найдено")
    reject_individual_chat_management(server)
    invite = db.scalar(select(ServerInvite).where(ServerInvite.id == initial.id).with_for_update().execution_options(populate_existing=True))
    if invite is None:
        raise HTTPException(404, "Приглашение не найдено")
    if is_server_blocked(db, server.id, user.id):
        raise HTTPException(403, "Сообщество заблокировано. Сначала снимите блокировку в настройках")
    membership = get_membership(db, server.id, user.id)
    joined = membership is None
    if joined:
        ensure_active(invite)
        db.add(ServerMember(server_id=server.id, user_id=user.id, role=MemberRole.MEMBER, nickname=user.username))
        invite.uses += 1
        db.flush()
    text, _ = ensure_group_chat_defaults(db, server) if server.kind == ServerKind.GROUP_CHAT else ensure_workspace_defaults(db, server)
    channel_id = text.id
    server_id = server.id
    kind = server.kind.value
    db.commit()
    if joined:
        publish_members_updated_from_sync(server_id, reason="member_added")
        publish_servers_changed_from_sync(reason="server_member_added")
    response.headers["Cache-Control"] = "no-store"
    return {"server_id": server_id, "channel_id": channel_id, "kind": kind, "joined": joined}
