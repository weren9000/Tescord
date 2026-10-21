"""Explicit cleanup for retired workspaces, never called by app startup."""
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import Attachment, Channel, Message, PlatformMigrationState, Server, ServerKind


def cleanup_plan(db: Session) -> dict:
    workspaces = list(db.scalars(select(Server).where(Server.kind == ServerKind.WORKSPACE).order_by(Server.id)))
    ids = [row.id for row in workspaces]
    channel_ids = list(db.scalars(select(Channel.id).where(Channel.server_id.in_(ids))))
    message_ids = list(db.scalars(select(Message.id).where(Message.channel_id.in_(channel_ids))))
    paths = set(db.scalars(select(Attachment.storage_path).where(
        Attachment.message_id.in_(message_ids), Attachment.storage_path.is_not(None))))
    shared_paths = set(db.scalars(select(Attachment.storage_path).where(
        ~Attachment.message_id.in_(message_ids), Attachment.storage_path.in_(paths))))
    return {"workspace_ids": [str(row.id) for row in workspaces],
            "workspaces": [{"id": str(row.id), "name": row.name} for row in workspaces],
            "channels": len(channel_ids), "messages": len(message_ids),
            "exclusive_attachment_paths": sorted(paths - shared_paths)}


def delete_legacy_workspaces(db: Session, expected_ids: list[str]) -> dict:
    # Stop the application before running the command at deployment time.
    db.execute(select(Server.id).where(Server.kind == ServerKind.WORKSPACE).with_for_update()).all()
    plan = cleanup_plan(db)
    if set(plan["workspace_ids"]) != set(expected_ids):
        raise ValueError("Workspace list changed; generate and review a new cleanup plan")
    db.execute(delete(Server).where(Server.kind == ServerKind.WORKSPACE))
    if db.get(PlatformMigrationState, 1) is None:
        db.add(PlatformMigrationState(id=1))
    db.flush()
    return plan
