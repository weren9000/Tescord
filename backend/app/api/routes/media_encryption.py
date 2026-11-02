"""Bounded, authenticated delivery; no endpoint accepts a plaintext media key."""
from datetime import timedelta
from hashlib import sha256
from types import SimpleNamespace
from uuid import UUID
import re
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.routes.secret_chats import Input, KeyUpload, canonical, b64, verify_signed, matrix_user, now, validate_ciphertext
from app.db.secret_chats import MediaCryptoDevice, MediaCryptoEnvelope, MediaCryptoPrekey
from app.db.session import get_db
from app.services.media_encryption import authorize
from app.services.pending_uploads import lock_owner
from app.services.rate_limits import enforce_limit

router=APIRouter(prefix='/media-encryption',tags=['media encryption'])


def ticket(x_media_token: str=Header()):
    return authorize(x_media_token)


def current(x_media_device: UUID=Header(), scope=Depends(ticket), db: Session=Depends(get_db)):
    device=db.get(MediaCryptoDevice,x_media_device)
    if not device or device.room != scope['room'] or device.identity != scope['identity']:
        raise HTTPException(403,'Устройство звонка недоступно; подключитесь заново')
    return device


def live_peer(db,device,target):
    peer=db.get(MediaCryptoDevice,target)
    if not peer or peer.room != device.room or peer.id == device.id or peer.seen_at < now()-timedelta(seconds=45):
        raise HTTPException(404,'Устройство участника недоступно')
    return peer


@router.put('/devices/{device_id}/keys')
def upload(device_id: UUID, body: KeyUpload, scope=Depends(ticket), db: Session=Depends(get_db)):
    lock_owner(db,UUID(scope['identity']))
    enforce_limit('media-keys-upload',scope['room']+':'+scope['identity'],60,300)
    if len(canonical(body.model_dump())) > 128*1024:
        raise HTTPException(413,'Слишком большой набор ключей')
    device=db.get(MediaCryptoDevice,device_id)
    identity=matrix_user(scope['identity'])
    if device and (device.room != scope['room'] or device.identity != scope['identity']):
        raise HTTPException(403,'Устройство принадлежит другому звонку')
    if device is None:
        value=body.device_keys
        try:
            if set(value)-{'user_id','device_id','algorithms','keys','signatures','unsigned'} or value['user_id'] != identity or value['device_id'] != str(device_id):
                raise ValueError()
            if set(value['algorithms']) != {'m.olm.v1.curve25519-aes-sha2','m.megolm.v1.aes-sha2'}:
                raise ValueError()
            keys=value['keys']
            if set(keys) != {'ed25519:'+str(device_id),'curve25519:'+str(device_id)}:
                raise ValueError()
            for key in keys.values():
                b64(key,32)
        except (TypeError,KeyError,ValueError):
            raise HTTPException(422,'Некорректные ключи звонка') from None
        verify_signed(value,identity,device_id,keys['ed25519:'+str(device_id)])
        previous=db.scalar(select(MediaCryptoDevice).where(MediaCryptoDevice.room == scope['room'],MediaCryptoDevice.identity == scope['identity']).with_for_update())
        if previous:
            db.delete(previous);db.flush()
        elif db.scalar(select(func.count()).select_from(MediaCryptoDevice).where(MediaCryptoDevice.room == scope['room'],MediaCryptoDevice.seen_at > now()-timedelta(seconds=45))) >= 100:
            raise HTTPException(409,'Превышен лимит участников защищённого звонка')
        device=MediaCryptoDevice(id=device_id,room=scope['room'],identity=scope['identity'],keys=value)
        db.add(device);db.flush()
    elif body.device_keys and canonical(body.device_keys) != canonical(device.keys):
        raise HTTPException(409,'Ключ звонка нельзя заменить без нового устройства')
    for key_id,payload in body.one_time_keys.items():
        try:
            if not re.fullmatch(r'signed_curve25519:[A-Za-z0-9_+/=-]{1,100}',key_id) or set(payload) != {'key','signatures'}:
                raise ValueError()
            b64(payload['key'],32)
        except (TypeError,KeyError,ValueError):
            raise HTTPException(422,'Некорректный одноразовый ключ') from None
        verify_signed(payload,identity,device_id,device.keys['keys']['ed25519:'+str(device_id)])
        existing=db.get(MediaCryptoPrekey,(device_id,key_id))
        if existing and canonical(existing.payload) != canonical(payload):
            raise HTTPException(409,'Одноразовый ключ уже используется')
        if not existing:
            db.add(MediaCryptoPrekey(device_id=device_id,key_id=key_id,payload=payload,claimed=False))
    db.flush()
    count=db.scalar(select(func.count()).select_from(MediaCryptoPrekey).where(MediaCryptoPrekey.device_id == device.id,MediaCryptoPrekey.claimed.is_(False)))
    if count > 200:
        raise HTTPException(409,'Превышен лимит ключей')
    device.seen_at=now();db.commit()
    return {'one_time_key_counts':{'signed_curve25519':count}}


@router.get('/state')
def state(device=Depends(current),db: Session=Depends(get_db)):
    device.seen_at=now()
    peers=list(db.scalars(select(MediaCryptoDevice).where(MediaCryptoDevice.room == device.room,MediaCryptoDevice.seen_at > now()-timedelta(seconds=45))))
    rows=list(db.scalars(select(MediaCryptoEnvelope).where(MediaCryptoEnvelope.recipient_id == device.id,MediaCryptoEnvelope.acknowledged.is_(False)).order_by(MediaCryptoEnvelope.sequence).limit(100)))
    count=db.scalar(select(func.count()).select_from(MediaCryptoPrekey).where(MediaCryptoPrekey.device_id == device.id,MediaCryptoPrekey.claimed.is_(False)))
    result={'devices':[{'identity':p.identity,'id':p.id,'device_keys':p.keys} for p in peers],
            'envelopes':[{'sequence':r.sequence,'sender_id':r.sender_id,'ciphertext':r.ciphertext} for r in rows],
            'one_time_key_counts':{'signed_curve25519':count}}
    db.commit()
    return result


class Claim(Input):
    device_id: UUID


@router.post('/claim')
def claim(body: Claim,device=Depends(current),db: Session=Depends(get_db)):
    peer=live_peer(db,device,body.device_id)
    enforce_limit('media-key-claim',str(device.id),120,300)
    key=db.scalar(select(MediaCryptoPrekey).where(MediaCryptoPrekey.device_id == peer.id,MediaCryptoPrekey.claimed.is_(False)).limit(1).with_for_update(skip_locked=True))
    result={}
    if key:
        key.claimed=True;result={matrix_user(peer.identity):{str(peer.id):{key.key_id:key.payload}}}
    db.commit()
    return {'one_time_keys':result,'failures':{}}


class Envelope(Input):
    recipient_id: UUID
    client_id: UUID
    ciphertext: dict


@router.post('/envelopes')
def send(body: Envelope,device=Depends(current),db: Session=Depends(get_db)):
    # Consistent advisory lock order avoids reciprocal-send FK deadlocks and
    # serializes both sender idempotency and recipient queue limits.
    for identity in sorted({device.id,body.recipient_id},key=lambda value:int.from_bytes(value.bytes[:4],'big',signed=True)):
        lock_owner(db,identity)
    peer=live_peer(db,device,body.recipient_id)
    enforce_limit('media-envelope',str(device.id),240,60)
    if len(canonical(body.ciphertext)) > 16*1024:
        raise HTTPException(413,'Слишком большой конверт ключа')
    validate_ciphertext(SimpleNamespace(kind='keys',ciphertext=body.ciphertext),
        SimpleNamespace(id=device.id,device_keys=device.keys),SimpleNamespace(id=peer.id,device_keys=peer.keys))
    digest=sha256(canonical({'recipient':str(peer.id),'ciphertext':body.ciphertext})).hexdigest()
    existing=db.scalar(select(MediaCryptoEnvelope).where(MediaCryptoEnvelope.sender_id == device.id,MediaCryptoEnvelope.client_id == body.client_id))
    if existing:
        if existing.digest != digest:
            raise HTTPException(409,'Идентификатор конверта уже использован')
        return {'sequence':existing.sequence}
    if db.scalar(select(func.count()).select_from(MediaCryptoEnvelope).where(MediaCryptoEnvelope.recipient_id == peer.id,MediaCryptoEnvelope.acknowledged.is_(False))) >= 500:
        raise HTTPException(409,'Очередь ключей участника заполнена')
    row=MediaCryptoEnvelope(sender_id=device.id,recipient_id=peer.id,client_id=body.client_id,ciphertext=body.ciphertext,digest=digest,acknowledged=False)
    db.add(row);db.commit()
    return {'sequence':row.sequence}


class Ack(Input):
    sequences:list[int]=Field(max_length=100)


@router.post('/ack')
def ack(body: Ack,device=Depends(current),db: Session=Depends(get_db)):
    for row in db.scalars(select(MediaCryptoEnvelope).where(MediaCryptoEnvelope.recipient_id == device.id,MediaCryptoEnvelope.sequence.in_(body.sequences)).with_for_update()):
        row.acknowledged=True;row.ciphertext={}
    db.commit();return {'ok':True}


@router.delete('/device',status_code=204)
def leave(device=Depends(current),db: Session=Depends(get_db)):
    db.delete(device);db.commit()
