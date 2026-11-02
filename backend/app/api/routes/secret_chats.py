"""Authenticated transport for a fixed pair of E2EE devices.

Matrix-compatible public key shapes are used by the maintained Olm/Megolm
engine. This is not a Matrix homeserver. No server endpoint accepts private keys
or plaintext messages; normal cloud message APIs cannot address these chats.
"""
import base64
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from io import BytesIO
from math import ceil
import re
import secrets
from typing import Literal
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import bearer_scheme, get_current_user
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.models import AuthSession, FriendRequest, FriendRequestStatus, User
from app.db.secret_chats import SecretChat, SecretDevice, SecretEnvelope, SecretPrekey, SecretUpload
from app.db.session import get_db
from app.services.contact_permissions import ensure_can_add_users
from app.services.pending_uploads import lock_owner, used_storage
from app.services.attachment_storage import resolve_attachment_path
from app.services.encrypted_files import StoredReader, write_file
from app.services.rate_limits import enforce_limit

router = APIRouter(prefix='/secret', tags=['secret chats'])


def now():
    return datetime.now(timezone.utc)


def matrix_user(user_id):
    return '@'+str(user_id)+':kvachat'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def b64(value, size=None):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', value):
        raise ValueError()
    result = base64.b64decode(value+'='*((-len(value))%4), validate=True)
    if size is not None and len(result) != size:
        raise ValueError()
    return result


def verify_signed(value, identity, device_id, public):
    try:
        signature = b64(value['signatures'][identity]['ed25519:'+str(device_id)], 64)
        unsigned = {k:v for k,v in value.items() if k not in {'signatures','unsigned'}}
        Ed25519PublicKey.from_public_bytes(b64(public, 32)).verify(signature, canonical(unsigned))
    except (ValueError, TypeError, KeyError, InvalidSignature):
        raise HTTPException(422, 'Некорректная подпись ключа устройства') from None


def enabled():
    if not get_settings().secret_chats_enabled:
        raise HTTPException(404, 'Секретные чаты пока недоступны')


def session_id(credentials):
    return UUID(decode_access_token(credentials.credentials, get_settings().secret_key)['sid'])


def device_alive(db, device):
    if not device or device.revoked:
        return False
    auth = db.get(AuthSession, device.auth_session_id)
    return bool(auth and auth.revoked_at is None and auth.expires_at > now())


def current_device(x_secret_device: UUID = Header(), user: User = Depends(get_current_user),
                   credentials=Depends(bearer_scheme), db: Session = Depends(get_db)):
    enabled()
    device = db.get(SecretDevice, x_secret_device)
    if not device_alive(db, device) or device.user_id != user.id or device.auth_session_id != session_id(credentials):
        raise HTTPException(403, 'Секретный чат доступен только на исходном устройстве и в его сеансе')
    return device


def chat_context(db, chat_id, device, *, lock=False, accepted=True):
    statement = select(SecretChat).where(SecretChat.id == chat_id)
    if lock:
        statement = statement.with_for_update()
    chat = db.scalar(statement)
    if not chat or device.id not in (chat.initiator_id, chat.recipient_id):
        raise HTTPException(404, 'Секретный чат недоступен')
    peer = db.get(SecretDevice, chat.recipient_id if device.id == chat.initiator_id else chat.initiator_id)
    if chat.closed_at or not device_alive(db, peer):
        raise HTTPException(410, 'Секретный чат завершён или устройство отключено')
    if accepted and not chat.accepted_at:
        raise HTTPException(409, 'Собеседник ещё не принял секретный чат')
    return chat, peer


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class KeyUpload(Input):
    name: str = Field(default='Устройство', min_length=1, max_length=80)
    device_keys: dict | None = None
    one_time_keys: dict = Field(default_factory=dict, max_length=100)
    fallback_keys: dict = Field(default_factory=dict, max_length=1)


@router.get('/capabilities')
def capabilities(user: User = Depends(get_current_user)):
    return {'enabled':get_settings().secret_chats_enabled, 'protocol':'olm-megolm-v1', 'max_file_bytes':get_settings().max_message_upload_bytes}


@router.put('/devices/{device_id}/keys')
def upload_keys(device_id: UUID, body: KeyUpload, user: User = Depends(get_current_user),
                credentials=Depends(bearer_scheme), db: Session = Depends(get_db)):
    enabled()
    enforce_limit('secret-keys-upload', str(user.id), 60, 300)
    lock_owner(db, user.id)
    if len(canonical(body.model_dump())) > 128*1024:
        raise HTTPException(413, 'Слишком большой набор ключей')
    device = db.get(SecretDevice, device_id)
    identity, sid = matrix_user(user.id), session_id(credentials)
    if device is not None and (device.user_id != user.id or device.auth_session_id != sid or device.revoked):
        raise HTTPException(409, 'Создайте новое устройство для этого сеанса')
    if device is None:
        if db.scalar(select(func.count()).select_from(SecretDevice).join(AuthSession,AuthSession.id == SecretDevice.auth_session_id).where(SecretDevice.user_id == user.id, SecretDevice.revoked.is_(False), AuthSession.revoked_at.is_(None), AuthSession.expires_at > now())) >= 10:
            raise HTTPException(409, 'Сначала отключите одно из старых устройств')
        value = body.device_keys
        try:
            if set(value) - {'user_id','device_id','algorithms','keys','signatures','unsigned'}:
                raise ValueError()
            if value['user_id'] != identity or value['device_id'] != str(device_id):
                raise ValueError()
            if set(value['algorithms']) != {'m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'}:
                raise ValueError()
            keys = value['keys']
            if set(keys) != {'ed25519:'+str(device_id), 'curve25519:'+str(device_id)}:
                raise ValueError()
            for key in keys.values():
                b64(key, 32)
        except (TypeError, KeyError, ValueError):
            raise HTTPException(422, 'Некорректные открытые ключи устройства') from None
        verify_signed(value, identity, device_id, keys['ed25519:'+str(device_id)])
        device = SecretDevice(id=device_id, user_id=user.id, auth_session_id=sid, name=body.name, device_keys=value, revoked=False)
        db.add(device)
        db.flush()
    elif body.device_keys and canonical(body.device_keys) != canonical(device.device_keys):
        raise HTTPException(409, 'Ключи зарегистрированного устройства нельзя заменить')
    for key_id, payload in body.one_time_keys.items():
        try:
            if not re.fullmatch(r'signed_curve25519:[A-Za-z0-9_+/=-]{1,100}', key_id):
                raise ValueError()
            if set(payload) != {'key','signatures'}:
                raise ValueError()
            b64(payload['key'],32)
        except (TypeError, ValueError, KeyError):
            raise HTTPException(422, 'Некорректный одноразовый ключ') from None
        verify_signed(payload, identity, device_id, device.device_keys['keys']['ed25519:'+str(device_id)])
        previous = db.get(SecretPrekey, (device_id, key_id))
        if previous and canonical(previous.payload) != canonical(payload):
            raise HTTPException(409, 'Одноразовый ключ уже зарегистрирован')
        if previous is None:
            db.add(SecretPrekey(device_id=device_id, key_id=key_id, payload=payload, claimed=False))
    # No reusable fallback key is advertised; replenish actual one-time keys.
    db.flush()
    count = db.scalar(select(func.count()).select_from(SecretPrekey).where(SecretPrekey.device_id == device_id, SecretPrekey.claimed.is_(False)))
    if count > 200:
        raise HTTPException(409, 'Превышен лимит одноразовых ключей')
    db.commit()
    return {'one_time_key_counts':{'signed_curve25519':count}}


@router.get('/devices')
def devices(user_id: UUID | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enabled()
    target = user_id or user.id
    if target != user.id:
        ensure_can_add_users(db, user.id, [target])
        friendship = db.scalar(select(FriendRequest.id).where(FriendRequest.status == FriendRequestStatus.ACCEPTED,
            or_(and_(FriendRequest.requester_user_id == user.id, FriendRequest.target_user_id == target),
                and_(FriendRequest.requester_user_id == target, FriendRequest.target_user_id == user.id))))
        if friendship is None:
            raise HTTPException(404, 'Сначала добавьте собеседника в друзья')
    return [{'id':d.id,'name':d.name,'created_at':d.created_at} for d in db.scalars(select(SecretDevice).where(SecretDevice.user_id == target).order_by(SecretDevice.created_at)) if (not d.revoked if target == user.id else device_alive(db,d))]


@router.post('/devices/{device_id}/session-challenge')
def session_challenge(device_id: UUID, user: User = Depends(get_current_user), credentials=Depends(bearer_scheme), db: Session = Depends(get_db)):
    enabled()
    enforce_limit('secret-session-proof',str(user.id),30,300)
    device = db.scalar(select(SecretDevice).where(SecretDevice.id == device_id).with_for_update())
    if device is None:
        return {'challenge':None}
    old = db.get(AuthSession,device.auth_session_id)
    if device.user_id != user.id or device.revoked or not old or old.revoked_at is not None:
        raise HTTPException(410,'Секретное устройство отключено. Его старую историю нельзя перенести в новый сеанс.')
    sid = session_id(credentials)
    if device.auth_session_id == sid:
        return {'challenge':None}
    challenge = {'purpose':'kvachat-device-session-v1','user_id':str(user.id),'device_id':str(device.id),
                 'session_id':str(sid),'nonce':secrets.token_hex(32),'expires':int(now().timestamp())+120}
    device.session_challenge = challenge
    db.commit()
    return {'challenge':challenge}


class SessionProof(Input):
    challenge: dict
    signatures: dict


@router.post('/devices/{device_id}/session-proof')
def session_proof(device_id: UUID, body: SessionProof, user: User = Depends(get_current_user), credentials=Depends(bearer_scheme), db: Session = Depends(get_db)):
    enabled()
    device = db.scalar(select(SecretDevice).where(SecretDevice.id == device_id).with_for_update())
    sid = session_id(credentials)
    if device is None or device.user_id != user.id or device.revoked:
        raise HTTPException(403,'Устройство недоступно')
    old = db.get(AuthSession,device.auth_session_id)
    expected = device.session_challenge
    if not old or old.revoked_at is not None or not expected or expected['expires'] < int(now().timestamp()) or expected['session_id'] != str(sid) or canonical(expected) != canonical(body.challenge):
        raise HTTPException(403,'Подтверждение устройства истекло или относится к другому сеансу')
    verify_signed({**body.challenge,'signatures':body.signatures},matrix_user(user.id),device.id,device.device_keys['keys']['ed25519:'+str(device.id)])
    device.auth_session_id = sid
    device.session_challenge = None
    db.commit()
    return {'ok':True}


@router.delete('/devices/{device_id}', status_code=204)
def revoke(device_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enabled()
    device = db.get(SecretDevice, device_id)
    if not device or device.user_id != user.id:
        raise HTTPException(404, 'Устройство недоступно')
    device.revoked = True
    for chat in db.scalars(select(SecretChat).where(or_(SecretChat.initiator_id == device_id, SecretChat.recipient_id == device_id))):
        chat.closed_at = now()
    db.commit()


class CreateChat(Input):
    peer_device_id: UUID


def summary(db, chat, device):
    peer = db.get(SecretDevice, chat.recipient_id if chat.initiator_id == device.id else chat.initiator_id)
    person = db.get(User, peer.user_id)
    return {'id':chat.id,'peer_device_id':peer.id,'peer_user_id':peer.user_id,'peer_name':person.username,
            'peer_device_name':peer.name,'initiator':chat.initiator_id == device.id,'accepted_at':chat.accepted_at,
            'closed_at':chat.closed_at,'created_at':chat.created_at, 'peer_available':device_alive(db,peer)}


@router.post('/chats', status_code=201)
def create_chat(body: CreateChat, device=Depends(current_device), db: Session = Depends(get_db)):
    enforce_limit('secret-chat-create', str(device.user_id), 20, 3600)
    peer = db.get(SecretDevice, body.peer_device_id)
    if not device_alive(db, peer) or peer.user_id == device.user_id:
        raise HTTPException(404, 'Устройство собеседника недоступно')
    devices(peer.user_id, db.get(User,device.user_id), db)
    chat = SecretChat(initiator_id=device.id, recipient_id=peer.id)
    db.add(chat)
    db.commit()
    return summary(db,chat,device)


@router.get('/chats')
def chats(device=Depends(current_device), db: Session = Depends(get_db)):
    rows = db.scalars(select(SecretChat).where(or_(SecretChat.initiator_id == device.id, SecretChat.recipient_id == device.id)).order_by(SecretChat.created_at.desc()).limit(200))
    return [summary(db, row, device) for row in rows]


@router.post('/chats/{chat_id}/accept')
def accept(chat_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    chat, peer = chat_context(db,chat_id,device,lock=True,accepted=False)
    if chat.recipient_id != device.id:
        raise HTTPException(403, 'Принять приглашение должен собеседник')
    ensure_can_add_users(db, device.user_id, [peer.user_id])
    chat.accepted_at = chat.accepted_at or now()
    db.commit()
    return summary(db,chat,device)


@router.delete('/chats/{chat_id}', status_code=204)
def close_chat(chat_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    chat = db.get(SecretChat,chat_id)
    if not chat or device.id not in (chat.initiator_id,chat.recipient_id):
        raise HTTPException(404, 'Чат недоступен')
    chat.closed_at = now()
    db.commit()


@router.post('/chats/{chat_id}/keys/query')
def query_keys(chat_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    chat, peer = chat_context(db,chat_id,device,accepted=False)
    result = {matrix_user(user_id):{} for user_id in (device.user_id,peer.user_id)}
    for d in db.scalars(select(SecretDevice).where(SecretDevice.user_id.in_([device.user_id,peer.user_id]))):
        if device_alive(db,d):
            result[matrix_user(d.user_id)][str(d.id)] = d.device_keys
    return {'device_keys':result,'failures':{}}


@router.post('/chats/{chat_id}/keys/claim')
def claim_key(chat_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    chat, peer = chat_context(db,chat_id,device,lock=True)
    enforce_limit('secret-key-claim', str(device.id), 60, 3600)
    key = db.scalar(select(SecretPrekey).where(SecretPrekey.device_id == peer.id, SecretPrekey.claimed.is_(False)).with_for_update(skip_locked=True).limit(1))
    result = {}
    if key:
        key.claimed = True
        result = {matrix_user(peer.user_id):{str(peer.id):{key.key_id:key.payload}}}
    db.commit()
    return {'one_time_keys':result,'failures':{}}


class QueryKeys(Input):
    device_keys: dict[str, list[str]] = Field(max_length=50)
    timeout: int | None = None
    token: str | None = None


@router.post('/keys/query')
def query_tracked_keys(body: QueryKeys, device=Depends(current_device), db: Session = Depends(get_db)):
    linked = list(db.scalars(select(SecretChat).where(SecretChat.closed_at.is_(None),
        or_(SecretChat.initiator_id == device.id, SecretChat.recipient_id == device.id))))
    peer_ids = [c.recipient_id if c.initiator_id == device.id else c.initiator_id for c in linked]
    allowed = {device.user_id, *db.scalars(select(SecretDevice.user_id).where(SecretDevice.id.in_(peer_ids)))}
    result = {}
    for identity in body.device_keys:
        users = [uid for uid in allowed if matrix_user(uid) == identity]
        result[identity] = {}
        if not users:
            continue
        for d in db.scalars(select(SecretDevice).where(SecretDevice.user_id == users[0])):
            if device_alive(db,d):
                result[identity][str(d.id)] = d.device_keys
    return {'device_keys':result,'failures':{}}


class EnvelopeInput(Input):
    client_id: UUID
    kind: Literal['keys','message']
    ciphertext: dict
    upload_ids: list[UUID] = Field(default_factory=list, max_length=1)


def validate_ciphertext(body, device, peer):
    value = body.ciphertext
    try:
        if len(canonical(value)) > 128*1024:
            raise ValueError()
        own_curve = device.device_keys['keys']['curve25519:'+str(device.id)]
        if value['sender_key'] != own_curve:
            raise ValueError()
        if body.kind == 'keys':
            if set(value) - {'algorithm','sender_key','ciphertext','org.matrix.msgid'} or value['algorithm'] != 'm.olm.v1.curve25519-aes-sha2':
                raise ValueError()
            if 'org.matrix.msgid' in value and not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value['org.matrix.msgid']):
                raise ValueError()
            target_curve = peer.device_keys['keys']['curve25519:'+str(peer.id)]
            if set(value['ciphertext']) != {target_curve}:
                raise ValueError()
            entry = value['ciphertext'][target_curve]
            if set(entry) != {'type','body'} or entry['type'] not in (0,1):
                raise ValueError()
            b64(entry['body'])
        else:
            if set(value) != {'algorithm','sender_key','ciphertext','session_id','device_id'} or value['algorithm'] != 'm.megolm.v1.aes-sha2' or value['device_id'] != str(device.id):
                raise ValueError()
            b64(value['session_id'],32)
            b64(value['ciphertext'])
    except (ValueError, TypeError, KeyError):
        raise HTTPException(422, 'Требуется зашифрованное сообщение поддерживаемого формата') from None


@router.post('/chats/{chat_id}/envelopes', status_code=201)
def send_envelope(chat_id: UUID, body: EnvelopeInput, background_tasks: BackgroundTasks, device=Depends(current_device), db: Session = Depends(get_db)):
    chat, peer = chat_context(db,chat_id,device,lock=True)
    ensure_can_add_users(db, device.user_id, [peer.user_id])
    enforce_limit('secret-send',str(device.id),120,60)
    validate_ciphertext(body,device,peer)
    digest = sha256(canonical({'chat':str(chat_id),'kind':body.kind,'ciphertext':body.ciphertext,'uploads':[str(i) for i in body.upload_ids]})).hexdigest()
    existing = db.scalar(select(SecretEnvelope).where(SecretEnvelope.sender_id == device.id, SecretEnvelope.client_id == body.client_id))
    if existing:
        if existing.digest != digest:
            raise HTTPException(409, 'Идентификатор сообщения уже использован')
        return {'sequence':existing.sequence,'client_id':existing.client_id}
    pending = db.scalar(select(func.count()).select_from(SecretEnvelope).where(SecretEnvelope.chat_id == chat_id, SecretEnvelope.acknowledged.is_(False)))
    if pending >= 2000:
        raise HTTPException(409, 'Дождитесь подключения собеседника')
    for upload_id in body.upload_ids:
        upload = db.scalar(select(SecretUpload).where(SecretUpload.id == upload_id).with_for_update())
        if body.kind != 'message' or upload is None or upload.owner_id != device.id or upload.chat_id != chat_id or not upload.complete:
            raise HTTPException(422, 'Вложение не готово или принадлежит другому чату')
        upload.published = True
    row = SecretEnvelope(chat_id=chat_id, sender_id=device.id, recipient_id=peer.id, client_id=body.client_id,
                         kind=body.kind,ciphertext=body.ciphertext,digest=digest,acknowledged=False)
    db.add(row)
    db.commit()
    if body.kind == 'message':
        from app.services.push_notifications import send_secret_push
        background_tasks.add_task(send_secret_push, peer.id)
    return {'sequence':row.sequence,'client_id':row.client_id}


@router.get('/chats/{chat_id}/envelopes')
def receive_envelopes(chat_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    chat_context(db,chat_id,device)
    rows = db.scalars(select(SecretEnvelope).where(SecretEnvelope.chat_id == chat_id, SecretEnvelope.recipient_id == device.id,
        SecretEnvelope.acknowledged.is_(False)).order_by(SecretEnvelope.sequence).limit(100))
    return [{'sequence':r.sequence,'client_id':r.client_id,'sender_device_id':r.sender_id,'kind':r.kind,'ciphertext':r.ciphertext} for r in rows]


class Acknowledge(Input):
    sequences: list[int] = Field(max_length=100)


@router.post('/chats/{chat_id}/ack')
def acknowledge(chat_id: UUID, body: Acknowledge, device=Depends(current_device), db: Session = Depends(get_db)):
    chat_context(db,chat_id,device)
    for row in db.scalars(select(SecretEnvelope).where(SecretEnvelope.chat_id == chat_id, SecretEnvelope.recipient_id == device.id,
                                                     SecretEnvelope.sequence.in_(body.sequences)).with_for_update()):
        row.acknowledged = True
        row.ciphertext = {}  # Keep only the idempotency receipt after device persistence.
    db.commit()
    return {'ok':True}


@router.get('/keys/counts')
def key_counts(device=Depends(current_device), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(SecretPrekey).where(SecretPrekey.device_id == device.id, SecretPrekey.claimed.is_(False)))
    return {'signed_curve25519':count}


FILE_CHUNK = 1024*1024


@router.get('/unread')
def unread(device=Depends(current_device), db: Session = Depends(get_db)):
    value = db.scalar(select(func.max(SecretEnvelope.sequence)).join(SecretChat,SecretChat.id == SecretEnvelope.chat_id).where(
        SecretEnvelope.recipient_id == device.id, SecretEnvelope.acknowledged.is_(False), SecretEnvelope.kind == 'message', SecretChat.closed_at.is_(None)))
    return {'latest':value or 0}


class StartUpload(Input):
    id: UUID
    size_bytes: int = Field(ge=16)
    chunk_count: int = Field(ge=1, le=501)


def upload_context(db, upload_id, device, *, owner=False, lock=False):
    query = select(SecretUpload).where(SecretUpload.id == upload_id)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query)
    if row is None or owner and row.owner_id != device.id:
        raise HTTPException(404, 'Вложение недоступно')
    chat_context(db,row.chat_id,device)
    return row


def chunk_path(upload_id, index):
    # These bytes are already encrypted on the sending device. The cloud
    # keyring is deliberately unnecessary for delivering secret attachments.
    return resolve_attachment_path(f'secret/{upload_id}/{upload_id}.{index}.bin')


def chunk_size(row,index):
    if index < 0 or index >= row.chunk_count:
        raise HTTPException(404,'Часть файла недоступна')
    return min(FILE_CHUNK+16, row.size_bytes-index*(FILE_CHUNK+16))


@router.post('/chats/{chat_id}/uploads', status_code=201)
def start_upload(chat_id: UUID, body: StartUpload, device=Depends(current_device), db: Session = Depends(get_db)):
    lock_owner(db, device.user_id)
    chat, peer = chat_context(db,chat_id,device)
    ensure_can_add_users(db,device.user_id,[peer.user_id])
    maximum = get_settings().max_message_upload_bytes
    plain_size = body.size_bytes - body.chunk_count*16
    if plain_size < 0 or plain_size > maximum or max(1,ceil(plain_size/FILE_CHUNK)) != body.chunk_count:
        raise HTTPException(413, 'Файл слишком большой или имеет неверный размер')
    existing = db.get(SecretUpload,body.id)
    if existing:
        if existing.owner_id != device.id or existing.chat_id != chat_id or existing.size_bytes != body.size_bytes or existing.chunk_count != body.chunk_count:
            raise HTTPException(409, 'Идентификатор загрузки уже используется')
        return {'id':existing.id}
    if used_storage(db,device.user_id)+body.size_bytes > get_settings().user_upload_quota_bytes:
        raise HTTPException(413,'Лимит хранения файлов исчерпан')
    pending = db.scalar(select(func.count()).select_from(SecretUpload).where(SecretUpload.owner_id == device.id, SecretUpload.complete.is_(False)))
    if pending >= 10:
        raise HTTPException(409,'Сначала завершите текущие загрузки')
    row = SecretUpload(id=body.id,chat_id=chat_id,owner_id=device.id,size_bytes=body.size_bytes,chunk_count=body.chunk_count,complete=False)
    db.add(row);db.commit()
    return {'id':row.id}


@router.put('/uploads/{upload_id}/chunks/{index}')
def put_chunk(upload_id: UUID, index: int, body: bytes = Body(media_type='application/octet-stream',max_length=FILE_CHUNK+16),
              device=Depends(current_device), db: Session = Depends(get_db)):
    row = upload_context(db,upload_id,device,owner=True,lock=True)
    if len(body) != chunk_size(row,index):
        raise HTTPException(422,'Неверный размер части файла')
    path = chunk_path(upload_id,index)
    if path.exists():
        with StoredReader(path) as source:
            if sha256(source.read()).digest() != sha256(body).digest():
                raise HTTPException(409,'Часть файла уже загружена с другим содержимым')
    else:
        if row.complete:
            raise HTTPException(409,'Загрузка уже завершена')
        write_file(BytesIO(body),path,max_bytes=FILE_CHUNK+16)
    db.commit()
    return {'ok':True}


@router.post('/uploads/{upload_id}/complete')
def complete_upload(upload_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    row = upload_context(db,upload_id,device,owner=True,lock=True)
    for index in range(row.chunk_count):
        path = chunk_path(upload_id,index)
        if not path.is_file():
            raise HTTPException(409,'Не все части файла загружены')
        with StoredReader(path) as source:
            if source.size != chunk_size(row,index):
                raise HTTPException(409,'Размер файла не совпадает')
            source.read()  # Authenticate every server-storage chunk before publishing.
    row.complete = True
    db.commit()
    return {'id':row.id}


@router.get('/uploads/{upload_id}/chunks/{index}')
def get_chunk(upload_id: UUID, index: int, device=Depends(current_device), db: Session = Depends(get_db)):
    row = upload_context(db,upload_id,device)
    if not row.complete:
        raise HTTPException(409,'Файл ещё загружается')
    expected = chunk_size(row,index)
    path = chunk_path(upload_id,index)
    if not path.is_file():
        raise HTTPException(404,'Файл удалён')
    with StoredReader(path) as source:
        data = source.read()
    if len(data) != expected:
        raise HTTPException(503,'Файл повреждён')
    return Response(data,media_type='application/octet-stream',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


@router.delete('/uploads/{upload_id}', status_code=204)
def discard_upload(upload_id: UUID, device=Depends(current_device), db: Session = Depends(get_db)):
    row = upload_context(db,upload_id,device,owner=True,lock=True)
    for index in range(row.chunk_count):
        chunk_path(upload_id,index).unlink(missing_ok=True)
    db.delete(row);db.commit()
