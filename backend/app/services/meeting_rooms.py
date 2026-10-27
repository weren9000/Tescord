"""Meeting capabilities are deliberately separate from account authentication.

All admissions and mutations lock the session row. Ended sessions remain as
durable cleanup jobs until both media and file deletion have succeeded.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import TokenError, create_signed_token, decode_signed_token
from app.db.models import AuthSession, MeetingRoom, RoomParticipant, RoomSession
from app.db.session import SessionLocal

OWNER_GRACE = timedelta(minutes=5)
PRESENCE_TTL = timedelta(seconds=60)
logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc)


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def files_root(session_id: UUID) -> Path:
    return Path(get_settings().uploads_dir).resolve().parent / 'meeting-files' / str(UUID(str(session_id)))


def owner_deadline(meeting: RoomSession):
    # Abrupt disconnects use the last acknowledged presence time, so server
    # restarts never reset or extend the five minute grace period.
    return (meeting.owner_left_at or meeting.owner_seen_at) + OWNER_GRACE


def require_live(db: Session, meeting: RoomSession | None):
    if meeting is None or meeting.ended_at:
        raise HTTPException(410, 'Встреча завершена')
    if owner_deadline(meeting) <= now():
        meeting.ended_at = now()
        meeting.invite_hash = None
        db.commit()
        raise HTTPException(410, 'Встреча завершена: владелец не вернулся за 5 минут')


def issue_token(participant: RoomParticipant):
    return create_signed_token({'purpose': 'meeting', 'pid': str(participant.id),
                                'meeting': str(participant.session_id),
                                'auth_sid': str(participant.auth_session_id) if participant.is_owner else None},
                               get_settings().secret_key, 12 * 3600)


def principal(db: Session, token: str, *, lock=False):
    try:
        claims = decode_signed_token(token, get_settings().secret_key)
        if claims.get('purpose') != 'meeting':
            raise ValueError()
        mid, pid = UUID(claims['meeting']), UUID(claims['pid'])
    except (TokenError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(401, 'Недействительная сессия встречи') from exc
    query = select(RoomSession).where(RoomSession.id == mid)
    meeting = db.scalar(query.with_for_update() if lock else query)
    require_live(db, meeting)
    participant = db.get(RoomParticipant, pid)
    if not participant or participant.session_id != mid or participant.revoked:
        raise HTTPException(403, 'Доступ к встрече закрыт')
    if participant.is_owner:
        auth = db.get(AuthSession, participant.auth_session_id) if participant.auth_session_id else None
        room = db.get(MeetingRoom, meeting.room_id)
        if (not auth or auth.revoked_at or auth.expires_at <= now() or auth.user_id != room.owner_id
                or claims.get('auth_sid') != str(auth.id)):
            raise HTTPException(401, 'Войдите в аккаунт повторно')
    return meeting, participant


def media_permission(room: str, identity: str, metadata: str = '{}'):
    try:
        mid, pid = UUID(room.removeprefix('meeting-')), UUID(identity)
    except (ValueError, TypeError):
        return None
    with SessionLocal() as db:
        meeting = db.get(RoomSession, mid)
        p = db.get(RoomParticipant, pid)
        if not meeting or meeting.ended_at or owner_deadline(meeting) <= now():
            return None
        if not p or p.session_id != mid or p.revoked or p.last_seen_at < now() - PRESENCE_TTL:
            return None
        if p.is_owner:
            auth = db.get(AuthSession, p.auth_session_id) if p.auth_session_id else None
            if not auth or auth.revoked_at or auth.expires_at <= now():
                return None
            try:
                if json.loads(metadata).get('auth_sid') != str(auth.id):
                    return None
            except (ValueError, TypeError, AttributeError):
                return None
        return not p.silenced


def expire_sessions():
    with SessionLocal() as db:
        for meeting in db.scalars(select(RoomSession).with_for_update(skip_locked=True)):
            if not meeting.ended_at and owner_deadline(meeting) <= now():
                meeting.ended_at = now()
                meeting.invite_hash = None
        db.commit()
        return list(db.scalars(select(RoomSession.id).where(RoomSession.ended_at.is_not(None))))


def cleanup_orphan_files():
    # Account deletion can cascade past sessions. Sweep their UUID directories
    # too; active uploads lock an existing session and are never orphaned here.
    root = Path(get_settings().uploads_dir).resolve().parent / 'meeting-files'
    if not root.is_dir():
        return
    with SessionLocal() as db:
        for path in root.iterdir():
            try:
                mid = UUID(path.name)
            except ValueError:
                continue
            if path.is_dir() and not path.is_symlink() and db.get(RoomSession, mid) is None:
                shutil.rmtree(path)


async def cleanup(mid: UUID):
    from livekit import api
    from app.services.voice_sfu import _client
    if get_settings().livekit_enabled:
        try:
            async with _client() as client:
                await client.room.delete_room(api.DeleteRoomRequest(room=f'meeting-{mid}'))
        except api.TwirpError as exc:
            if exc.code != 'not_found':
                raise
    def finish():
        with SessionLocal() as db:
            meeting = db.scalar(select(RoomSession).where(RoomSession.id == mid).with_for_update())
            if not meeting or not meeting.ended_at:
                return
            path = files_root(mid)
            if path.exists():
                shutil.rmtree(path)
            db.delete(meeting)
            db.commit()
    await asyncio.to_thread(finish)


async def run_room_cleanup():
    while True:
        try:
            for mid in await asyncio.to_thread(expire_sessions):
                try:
                    await cleanup(mid)
                except Exception:
                    logger.warning('Meeting cleanup deferred: %s', mid)
            await asyncio.to_thread(cleanup_orphan_files)
        except Exception:
            logger.exception('Meeting sweep deferred')
        await asyncio.sleep(5)
