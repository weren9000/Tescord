"""Authorization tickets carry no media keys and cannot authorize account APIs."""
import json
from uuid import UUID
from fastapi import HTTPException
from app.core.config import get_settings
from app.core.security import create_signed_token, decode_signed_token, TokenError


PROTOCOL = 'olm-livekit-v1'


def require_client(protocol):
    if get_settings().media_encryption_enabled and protocol != PROTOCOL:
        raise HTTPException(426,'Обновите Квачат: для этого звонка требуется сквозное шифрование')


def grant(room, identity, metadata):
    if not get_settings().media_encryption_enabled:
        return None
    return {'protocol':PROTOCOL,'room':room,'identity':identity,'token':create_signed_token({'kind':'media-encryption','room':room,'identity':identity,
        'metadata':metadata},get_settings().secret_key,24*3600)}


def authorize(token):
    if not get_settings().media_encryption_enabled:
        raise HTTPException(404,'Защищённые звонки недоступны')
    try:
        value = decode_signed_token(token,get_settings().secret_key)
        if value.get('kind') != 'media-encryption' or not isinstance(value['room'],str) or len(value['room']) > 100:
            raise ValueError()
        UUID(value['identity'])
        from app.services.voice_sfu import media_permission
        if media_permission(value['room'],value['identity'],json.dumps(value['metadata']),joining=True) is None:
            raise ValueError()
        return value
    except (TokenError,ValueError,TypeError,KeyError):
        raise HTTPException(403,'Нет доступа к ключам этого звонка') from None
