"""Short-lived, purpose-bound challenges; callers hold user/challenge row locks."""
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
import pyotp
from sqlalchemy import delete, select, update

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.models import AuthChallenge, AuthSession, PushSubscription, RecoveryCode, User
from app.services.rate_limits import enforce_limit

DUMMY_PASSWORD_HASH = hash_password('not-an-account-' + secrets.token_hex(32))


def now():
    return datetime.now(timezone.utc)


def cipher():
    key = get_settings().auth_encryption_key
    if not key:
        raise HTTPException(503, 'Защита аккаунта ещё не настроена. Попробуйте позже.')
    return Fernet(key.get_secret_value().encode())


def encrypt(value: str) -> str:
    return cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return cipher().decrypt(value.encode()).decode()
    except InvalidToken:
        raise HTTPException(503, 'Защита аккаунта временно недоступна.') from None


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def code_digest(context: str, code: str) -> str:
    key = get_settings().auth_encryption_key
    if not key:
        cipher()
    return hmac.new(key.get_secret_value().encode(), f'{context}:{code}'.encode(), hashlib.sha256).hexdigest()


def new_challenge(db, purpose: str, *, seconds=300, **values):
    token = secrets.token_urlsafe(32)
    challenge = AuthChallenge(token_hash=digest(token), purpose=purpose,
                              expires_at=now() + timedelta(seconds=seconds), **values)
    db.add(challenge)
    db.flush()
    return challenge, token


def get_challenge(db, token: str, purpose: str, *, lock=True):
    query = select(AuthChallenge).where(AuthChallenge.token_hash == digest(token), AuthChallenge.purpose == purpose)
    if lock:
        query = query.with_for_update()
    challenge = db.scalar(query.execution_options(populate_existing=True))
    if challenge is None or challenge.consumed_at or challenge.expires_at <= now() or challenge.attempts >= 5:
        raise HTTPException(400, 'Проверка истекла или недействительна. Начните заново.')
    return challenge


def reject_attempt(db, challenge):
    challenge.attempts += 1
    db.commit()  # Persist failed attempts even though the request is rejected.
    raise HTTPException(400, 'Неверный или уже использованный код. Проверьте код и время на устройстве.')


def locked_user(db, user_id):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise HTTPException(401, 'Требуется авторизация')
    return user


def check_password(user, password):
    enforce_limit('security-password', str(user.id), 10, 300)
    if not verify_password(password, user.password_hash):
        raise HTTPException(400, 'Не удалось подтвердить действие. Проверьте пароль.')


def totp_step(secret: str, code: str, last_step: int) -> int | None:
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    current = int(now().timestamp()) // 30
    totp = pyotp.TOTP(secret, digits=6, interval=30)
    for step in (current, current - 1, current + 1):
        if step > last_step and hmac.compare_digest(totp.at(step * 30), code):
            return step
    return None


def use_second_factor(db, user, code: str) -> bool:
    if not user.totp_enabled_at or not user.totp_secret:
        return False
    enforce_limit('totp-account', str(user.id), 20, 300)
    step = totp_step(decrypt(user.totp_secret), code, user.totp_last_step)
    if step is not None:
        user.totp_last_step = step
        return True
    normalized = code.replace('-', '').replace(' ', '').upper()
    recovery = db.scalar(select(RecoveryCode).where(
        RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None),
        RecoveryCode.code_hash == code_digest(str(user.id), normalized)).with_for_update())
    if recovery is None:
        return False
    recovery.used_at = now()
    return True


def replace_recovery_codes(db, user):
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = [secrets.token_hex(10).upper() for _ in range(10)]
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=code_digest(str(user.id), code)))
    return ['-'.join(code[i:i+5] for i in range(0, len(code), 5)) for code in codes]


def revoke_sessions(db, user_id, *, keep=None):
    condition = [AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)]
    if keep:
        condition.append(AuthSession.id != keep)
    revoked = list(db.scalars(update(AuthSession).where(*condition).values(revoked_at=now()).returning(AuthSession.id)))
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id,
        PushSubscription.session_id.in_(revoked) | PushSubscription.session_id.is_(None)))


def security_changed(db, user, session_id):
    user.security_version += 1
    revoke_sessions(db, user.id, keep=session_id)
    db.execute(update(AuthChallenge).where(AuthChallenge.user_id == user.id,
        AuthChallenge.consumed_at.is_(None)).values(consumed_at=now(), secret=None))
