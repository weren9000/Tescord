from __future__ import annotations

import json
import secrets
import asyncio
import logging
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, Response
from livekit import api
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, tuple_
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.models import (User, MeetingRoom, RoomSession, RoomParticipant,
                           RoomMessage, RoomUpload, RoomReaction)
from app.db.session import get_db
from app.services import meeting_rooms as service
from app.services.rate_limits import enforce_limit

router = APIRouter(prefix='/rooms', tags=['rooms'])


class InviteOptions(BaseModel):
    hours: int = Field(default=24, ge=1, le=168)
    uses: int = Field(default=49, ge=1, le=1000)


class JoinInput(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    nonce: str = Field(min_length=32, max_length=128, pattern=r'^[a-zA-Z0-9_-]+$')

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = ''.join(c for c in value.strip() if c.isprintable())
        if not value:
            raise ValueError('Введите имя')
        return value


class ControlInput(BaseModel):
    action: str = Field(pattern=r'^(lock|unlock|end|kick|silence|unsilence)$')
    participant_id: UUID | None = None


class MessageInput(BaseModel):
    content: str = Field(default='', max_length=10000)
    reply_to_id: UUID | None = None
    uploads: list[UUID] = Field(default_factory=list, max_length=10)


class ReactionInput(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


def access(db, authorization, *, lock=False):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Войдите во встречу')
    return service.principal(db, authorization[7:], lock=lock)


def owner(p):
    if not p.is_owner:
        raise HTTPException(403, 'Действие доступно только владельцу')


def new_invite(meeting, options):
    raw = secrets.token_urlsafe(32)
    meeting.invite_hash = service.digest(raw)
    meeting.invite_expires_at = service.now() + timedelta(hours=options.hours)
    meeting.invite_limit = options.uses
    meeting.invite_uses = 0
    return raw


def ticket(meeting, p):
    return {'token': service.issue_token(p), 'participant_id': str(p.id),
            'session_id': str(meeting.id), 'is_owner': p.is_owner}


def find_invite(db, raw, *, lock=False):
    if not 32 <= len(raw) <= 128:
        raise HTTPException(404, 'Ссылка недействительна')
    stmt = select(RoomSession).where(RoomSession.invite_hash == service.digest(raw))
    meeting = db.scalar(stmt.with_for_update() if lock else stmt)
    service.require_live(db, meeting)
    if meeting.invite_expires_at <= service.now():
        raise HTTPException(410, 'Срок действия ссылки истёк')
    return meeting


def reserve(db, meeting, p=None):
    active = db.scalar(select(func.count()).select_from(RoomParticipant).where(
        RoomParticipant.session_id == meeting.id, RoomParticipant.is_owner.is_(False),
        RoomParticipant.revoked.is_(False),
        RoomParticipant.last_seen_at > service.now() - service.PRESENCE_TTL))
    # Owner always has a reserved seat, including during their absence.
    if not (p and (p.is_owner or p.last_seen_at > service.now() - service.PRESENCE_TTL)) and active >= 49:
        raise HTTPException(409, 'В комнате уже 50 участников')


@router.get('/mine')
def mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.scalar(select(MeetingRoom).where(MeetingRoom.owner_id == user.id))
    meeting = db.scalar(select(RoomSession).where(RoomSession.room_id == room.id)) if room else None
    return {'name': room.name if room else 'Моя комната', 'active': bool(meeting and not meeting.ended_at and service.owner_deadline(meeting) > service.now()),
            'cleanup_pending': bool(meeting and (meeting.ended_at or service.owner_deadline(meeting) <= service.now()))}


@router.post('/start')
def start(options: InviteOptions, user: User = Depends(get_current_user),
          authorization: str = Header(), db: Session = Depends(get_db)):
    # Lock the account to serialize creation of the permanent room as well.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    room = db.scalar(select(MeetingRoom).where(MeetingRoom.owner_id == user.id))
    if not room:
        room = MeetingRoom(owner_id=user.id)
        db.add(room)
        db.flush()
    meeting = db.scalar(select(RoomSession).where(RoomSession.room_id == room.id).with_for_update())
    raw = None
    if meeting:
        service.require_live(db, meeting)
    else:
        meeting = RoomSession(room_id=room.id, owner_seen_at=service.now())
        raw = new_invite(meeting, options)
        db.add(meeting)
        db.flush()
    p = db.scalar(select(RoomParticipant).where(RoomParticipant.session_id == meeting.id, RoomParticipant.is_owner.is_(True)))
    sid = UUID(decode_access_token(authorization[7:], get_settings().secret_key)['sid'])
    if not p:
        p = RoomParticipant(session_id=meeting.id, name=user.username, is_owner=True,
                            join_hash=service.digest(secrets.token_urlsafe(32)), last_seen_at=service.now(), auth_session_id=sid)
        db.add(p)
    p.auth_session_id = sid
    p.last_seen_at = meeting.owner_seen_at = service.now()
    meeting.owner_left_at = None
    db.commit()
    return {**ticket(meeting, p), 'invite': raw}


@router.get('/invite/{raw}')
def invite_info(raw: str, db: Session = Depends(get_db)):
    m = find_invite(db, raw)
    room = db.get(MeetingRoom, m.room_id)
    return {'name': room.name, 'locked': m.locked, 'remaining_uses': max(0, m.invite_limit-m.invite_uses),
            'expires_at': m.invite_expires_at, 'capacity': 50}


@router.post('/invite/{raw}/join')
def join(raw: str, body: JoinInput, request: Request, db: Session = Depends(get_db)):
    enforce_limit('meeting-join', request.client.host if request.client else '', 120, 300)
    m = find_invite(db, raw, lock=True)
    p = db.scalar(select(RoomParticipant).where(RoomParticipant.session_id == m.id, RoomParticipant.join_hash == service.digest(body.nonce)))
    if p and p.revoked:
        raise HTTPException(403, 'Вы удалены из встречи')
    if not p:
        if m.locked:
            raise HTTPException(403, 'Владелец закрыл вход')
        if m.invite_uses >= m.invite_limit:
            raise HTTPException(410, 'Лимит входов по ссылке исчерпан')
        reserve(db, m)
        p = RoomParticipant(session_id=m.id, name=body.name, join_hash=service.digest(body.nonce), last_seen_at=service.now())
        db.add(p)
        m.invite_uses += 1
    else:
        reserve(db, m, p)
        p.last_seen_at = service.now()
    db.commit()
    return ticket(m, p)


@router.post('/heartbeat')
def heartbeat(authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    reserve(db, m, p)
    p.last_seen_at = service.now()
    if p.is_owner:
        m.owner_seen_at = p.last_seen_at
        m.owner_left_at = None
    db.commit()
    return ticket(m, p)


@router.get('/state')
def state(authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization)
    people = db.scalars(select(RoomParticipant).where(RoomParticipant.session_id == m.id,
        RoomParticipant.revoked.is_(False), RoomParticipant.last_seen_at > service.now()-service.PRESENCE_TTL)).all()
    absent = m.owner_left_at is not None or m.owner_seen_at < service.now()-timedelta(seconds=30)
    return {'name': db.get(MeetingRoom, m.room_id).name, 'locked': m.locked,
            'chat_revision': m.chat_revision,
            'owner_deadline': service.owner_deadline(m) if absent else None,
            'server_time': service.now(), 'invite_expires_at': m.invite_expires_at if p.is_owner else None,
            'remaining_uses': m.invite_limit-m.invite_uses if p.is_owner else None,
            'participants': [{'id': str(x.id), 'name': x.name, 'is_owner': x.is_owner, 'silenced': x.silenced} for x in people]}


@router.post('/leave')
def leave(authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    p.last_seen_at = service.now()-service.PRESENCE_TTL
    if p.is_owner and not m.owner_left_at:
        m.owner_left_at = service.now()
    db.commit()
    return {'ok': True}


@router.post('/control')
def control(body: ControlInput, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    owner(p)
    if body.action == 'end':
        m.ended_at, m.invite_hash = service.now(), None
    elif body.action in {'lock', 'unlock'}:
        m.locked = body.action == 'lock'
    else:
        target = db.get(RoomParticipant, body.participant_id) if body.participant_id else None
        if not target or target.session_id != m.id or target.is_owner:
            raise HTTPException(404, 'Участник не найден')
        if body.action == 'kick':
            target.revoked = True
        else:
            target.silenced = body.action == 'silence'
    meeting_id = m.id
    target_id = body.participant_id
    db.commit()
    # Best effort immediate SFU enforcement. Persisted permissions already deny
    # access; the reconciler retries if the media server is briefly unavailable.
    if body.action == 'end':
        try:
            asyncio.run(service.cleanup(meeting_id))
        except Exception:
            logging.getLogger(__name__).warning('Meeting cleanup queued: %s', meeting_id)
    elif target_id and body.action in {'kick', 'silence', 'unsilence'}:
        from app.services.voice_sfu import enforce_participant
        try:
            asyncio.run(enforce_participant(f'meeting-{meeting_id}', target_id,
                can_publish=None if body.action == 'kick' else body.action == 'unsilence'))
        except HTTPException:
            pass
    return {'ok': True}


@router.post('/invite')
def rotate(options: InviteOptions, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    owner(p)
    raw = new_invite(m, options)
    db.commit()
    return {'invite': raw}


@router.post('/media')
def media(authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    reserve(db, m, p)
    if p.last_seen_at <= service.now()-service.PRESENCE_TTL:
        raise HTTPException(409, 'Обновите присутствие во встрече')
    settings = get_settings()
    if not settings.livekit_enabled:
        raise HTTPException(503, 'Сервер конференций недоступен')
    token = (api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(p.id)).with_name(p.name)
        .with_metadata(json.dumps({'meeting': str(m.id), 'auth_sid': str(p.auth_session_id) if p.is_owner else None})).with_ttl(timedelta(minutes=5))
        .with_room_config(api.RoomConfiguration(max_participants=50, empty_timeout=300, departure_timeout=300))
        .with_grants(api.VideoGrants(room_join=True, room=f'meeting-{m.id}', can_publish=not p.silenced, can_subscribe=True, can_publish_data=False))
        .to_jwt())
    return {'url': settings.livekit_url, 'token': token}


def message_in(db, mid, session_id):
    msg = db.get(RoomMessage, mid)
    if not msg or msg.session_id != session_id:
        raise HTTPException(404, 'Сообщение не найдено')
    return msg


@router.get('/messages')
def messages(before: UUID | None = None, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization)
    query = select(RoomMessage).where(RoomMessage.session_id == m.id)
    if before:
        cursor = message_in(db, before, m.id)
        query = query.where(tuple_(RoomMessage.created_at, RoomMessage.id) < tuple_(cursor.created_at, cursor.id))
    items = list(db.scalars(query.order_by(RoomMessage.created_at.desc(), RoomMessage.id.desc()).limit(200)))
    ids = [x.id for x in items]
    uploads = db.scalars(select(RoomUpload).where(RoomUpload.message_id.in_(ids))).all() if ids else []
    reactions = db.scalars(select(RoomReaction).where(RoomReaction.message_id.in_(ids))).all() if ids else []
    authors = {x.id: x.name for x in db.scalars(select(RoomParticipant).where(RoomParticipant.id.in_({x.author_id for x in items})))}
    return [{'id': str(x.id), 'author_id': str(x.author_id), 'author': authors.get(x.author_id, 'Гость'),
             'content': x.content, 'created_at': x.created_at, 'edited_at': x.edited_at,
             'reply_to_id': str(x.reply_to_id) if x.reply_to_id else None,
             'uploads': [{'id': str(u.id), 'filename': u.filename, 'size': u.size_bytes, 'mime_type': u.mime_type} for u in uploads if u.message_id == x.id],
             'reactions': [{'emoji': r.emoji, 'participant_id': str(r.participant_id)} for r in reactions if r.message_id == x.id]} for x in reversed(items)]


@router.post('/messages')
def send_message(body: MessageInput, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    enforce_limit('meeting-message', str(p.id), 60, 60)
    if not body.content.strip() and not body.uploads:
        raise HTTPException(422, 'Введите сообщение или добавьте файл')
    if body.reply_to_id:
        message_in(db, body.reply_to_id, m.id)
    uploads = [db.get(RoomUpload, uid) for uid in set(body.uploads)]
    if any(not u or u.session_id != m.id or u.author_id != p.id or u.message_id for u in uploads):
        raise HTTPException(404, 'Вложение недоступно')
    msg = RoomMessage(session_id=m.id, author_id=p.id, content=body.content.strip(), reply_to_id=body.reply_to_id)
    db.add(msg)
    db.flush()
    for u in uploads:
        u.message_id = msg.id
    m.chat_revision += 1
    db.commit()
    return {'id': str(msg.id)}


@router.patch('/messages/{mid}')
def edit_message(mid: UUID, body: MessageInput, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    msg = message_in(db, mid, m.id)
    if msg.author_id != p.id:
        raise HTTPException(403, 'Можно редактировать только свои сообщения')
    if not body.content.strip() and not db.scalar(select(RoomUpload.id).where(RoomUpload.message_id == mid).limit(1)):
        raise HTTPException(422, 'Сообщение не может быть пустым')
    msg.content, msg.edited_at = body.content.strip(), service.now()
    m.chat_revision += 1
    db.commit()
    return {'ok': True}


@router.delete('/messages/{mid}')
def delete_message(mid: UUID, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    msg = message_in(db, mid, m.id)
    if msg.author_id != p.id and not p.is_owner:
        raise HTTPException(403, 'Недостаточно прав')
    # Files stay owned by the session cleanup job even after removing a message.
    # Delete them before the rows: failed deletion can safely be retried.
    for u in db.scalars(select(RoomUpload).where(RoomUpload.message_id == mid)):
        path = service.files_root(m.id)/str(u.id)
        path.unlink(missing_ok=True)
        from app.services.attachment_previews import delete_preview
        delete_preview(path)
    db.delete(msg)
    m.chat_revision += 1
    db.commit()
    return {'ok': True}


@router.post('/messages/{mid}/reaction')
def reaction(mid: UUID, body: ReactionInput, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    message_in(db, mid, m.id)
    if body.emoji not in {'👍', '❤️', '😂', '🎉', '👀', '😢'}:
        raise HTTPException(422, 'Неизвестная реакция')
    current = db.scalar(select(RoomReaction).where(RoomReaction.message_id == mid, RoomReaction.participant_id == p.id, RoomReaction.emoji == body.emoji))
    if current:
        db.delete(current)
    else:
        db.add(RoomReaction(message_id=mid, participant_id=p.id, emoji=body.emoji))
    m.chat_revision += 1
    db.commit()
    return {'ok': True}


@router.post('/uploads')
def upload(file: UploadFile = File(), authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    enforce_limit('meeting-upload', str(p.id), 20, 60)
    settings = get_settings()
    size = file.size or 0
    total = db.scalar(select(func.coalesce(func.sum(RoomUpload.size_bytes), 0)).where(RoomUpload.session_id == m.id))
    if size > settings.max_message_upload_bytes or total+size > settings.user_upload_quota_bytes:
        raise HTTPException(413, 'Лимит файлов встречи исчерпан')
    pending = db.scalar(select(func.count()).select_from(RoomUpload).where(RoomUpload.session_id == m.id, RoomUpload.author_id == p.id, RoomUpload.message_id.is_(None)))
    if pending >= 10:
        raise HTTPException(409, 'Сначала отправьте уже загруженные файлы')
    filename = (file.filename or 'file').replace('\\', '/').rsplit('/', 1)[-1]
    filename = ''.join(c for c in filename if c.isprintable())[:255] or 'file'
    u = RoomUpload(session_id=m.id, author_id=p.id, filename=filename, mime_type=(file.content_type or 'application/octet-stream')[:128], size_bytes=size)
    db.add(u)
    db.flush()
    root = service.files_root(m.id)
    root.mkdir(parents=True, exist_ok=True)
    path = root/str(u.id)
    written = 0
    try:
        with path.open('xb') as out:
            while chunk := file.file.read(1024*1024):
                written += len(chunk)
                if written > settings.max_message_upload_bytes or total+written > settings.user_upload_quota_bytes:
                    raise HTTPException(413, 'Файл слишком большой')
                out.write(chunk)
        u.size_bytes = written
        db.commit()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {'id': str(u.id), 'filename': filename}


@router.delete('/uploads/{uid}')
def discard_upload(uid: UUID, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization, lock=True)
    u = db.get(RoomUpload, uid)
    if not u or u.session_id != m.id or u.author_id != p.id or u.message_id:
        raise HTTPException(404, 'Файл недоступен')
    (service.files_root(m.id)/str(uid)).unlink(missing_ok=True)
    db.delete(u)
    db.commit()
    return {'ok': True}


@router.get('/uploads/{uid}')
def download(uid: UUID, preview: bool = False, text_preview: bool = False, authorization: str = Header(), db: Session = Depends(get_db)):
    m, p = access(db, authorization)
    u = db.get(RoomUpload, uid)
    if not u or u.session_id != m.id or (not u.message_id and u.author_id != p.id):
        raise HTTPException(404, 'Файл недоступен')
    path = service.files_root(m.id)/str(u.id)
    if not path.is_file():
        raise HTTPException(404, 'Файл удалён')
    if text_preview:
        with path.open('rb') as source:
            return Response(source.read(1024*1024+1), media_type='text/plain', headers={'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'})
    if preview:
        from app.services.attachment_previews import ensure_preview
        path = ensure_preview(path)
        if not path:
            raise HTTPException(404, 'Предпросмотр недоступен')
    return FileResponse(path, media_type='image/webp' if preview else 'application/octet-stream',
                        filename=None if preview else u.filename,
                        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
