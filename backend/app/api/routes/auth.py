from datetime import timedelta
from io import BytesIO
import base64
import hmac
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
import pyotp
import segno
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies.auth import bearer_scheme, get_current_user
from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.models import AuthChallenge, AuthSession, PushSubscription, RecoveryCode, User
from app.db.session import get_db
from app.schemas.auth import (AuthUserResponse, LoginRequest, RegisterRequest, TokenResponse,
    EmailStartRequest, ChallengeResponse, CodeRequest, EmailVerifiedResponse,
    TwoFactorRequired, PasswordRequest, SecurityActionRequest)
from app.services import auth_security as security
from app.services.auth_mail import queue_mail, require_mail, security_notice
from app.services.default_tavern import ensure_default_tavern_access_for_user
from app.services.rate_limits import enforce_limit
from app.services.user_public_id import generate_next_public_user_id

router = APIRouter(prefix='/auth', tags=['auth'])


def build_token_response(user: User, db: Session) -> TokenResponse:
    if not user.email_verified_at:
        raise HTTPException(403, 'Сначала подтвердите почту.')
    settings = get_settings()
    session = AuthSession(user_id=user.id, expires_at=security.now() + timedelta(minutes=settings.access_token_expire_minutes))
    db.add(session)
    db.commit()
    db.refresh(session)
    return TokenResponse(access_token=create_access_token(str(user.id), settings.secret_key,
        settings.access_token_expire_minutes, session_id=str(session.id)), user=AuthUserResponse.from_user(user))


@router.post('/email/start', response_model=ChallengeResponse)
def start_email(payload: EmailStartRequest, db: Session = Depends(get_db)):
    require_mail()
    email = payload.email
    enforce_limit('email-send', email, 6, 3600)
    # Serialize issuance per address across workers without reserving a User.
    lock = int(security.digest(email)[:16], 16) - 2**63
    db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': lock})
    recent = db.scalar(select(AuthChallenge.sent_at).where(AuthChallenge.email == email,
        AuthChallenge.sent_at.is_not(None)).order_by(AuthChallenge.sent_at.desc()).limit(1))
    if recent and recent > security.now() - timedelta(seconds=60):
        retry = max(1, 60 - int((security.now() - recent).total_seconds()))
        raise HTTPException(429, 'Подождите перед повторной отправкой.', headers={'Retry-After': str(retry)})
    if payload.challenge_token:
        challenge = security.get_challenge(db, payload.challenge_token, 'email')
        if challenge.email != email:
            raise HTTPException(400, 'Начните подтверждение почты заново.')
        token = payload.challenge_token
    else:
        challenge, token = security.new_challenge(db, 'email', seconds=600, email=email)
    code = f'{secrets.randbelow(1_000_000):06d}'
    challenge.code_hash = security.code_digest(str(challenge.id), code)
    challenge.sent_at = security.now()
    remaining = max(1, int((challenge.expires_at - security.now()).total_seconds()))
    queue_mail(db, email, 'Квачат: подтверждение почты',
        f'Ваш код: {code}\nОн действует до {challenge.expires_at:%H:%M} UTC и используется один раз.\n'
        'Если вы не запрашивали код, просто проигнорируйте это письмо.', expires_at=challenge.expires_at)
    db.commit()
    return ChallengeResponse(challenge_token=token, expires_in=remaining)


@router.post('/email/verify', response_model=EmailVerifiedResponse)
def verify_email(payload: CodeRequest, db: Session = Depends(get_db)):
    challenge = security.get_challenge(db, payload.challenge_token, 'email')
    if not hmac.compare_digest(challenge.code_hash or '', security.code_digest(str(challenge.id), payload.code)):
        security.reject_attempt(db, challenge)
    grant = secrets.token_urlsafe(32)
    challenge.purpose = 'registration'
    challenge.token_hash = security.digest(grant)
    challenge.code_hash = None
    challenge.verified_at = security.now()
    challenge.expires_at = security.now() + timedelta(minutes=10)
    db.commit()
    return EmailVerifiedResponse(registration_token=grant, email=challenge.email)


@router.post('/register', response_model=TokenResponse, status_code=201)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    if not payload.registration_token:
        raise HTTPException(426, 'Для регистрации с подтверждением почты обновите приложение или откройте сайт Квачата.')
    grant = security.get_challenge(db, payload.registration_token, 'registration')
    email, nick = payload.email.strip().lower(), payload.nick.strip()
    if grant.email != email or not grant.verified_at:
        raise HTTPException(400, 'Подтвердите указанный адрес почты.')
    if payload.password != payload.password_confirmation:
        raise HTTPException(400, 'Пароли не совпадают')
    if len(nick) < 2:
        raise HTTPException(400, 'Ник должен содержать не менее двух символов.')
    public_id = generate_next_public_user_id(db)
    existing = db.scalar(select(User.id).where(or_(func.lower(User.email) == email,
        func.lower(User.username) == nick.lower())).limit(1))
    if existing:
        raise HTTPException(409, 'Почта или ник уже используются. Войдите в аккаунт или выберите другой ник.')
    user = User(public_id=public_id, email=email, username=nick, password_hash=hash_password(payload.password),
                email_verified_at=grant.verified_at, email_verification_source='email')
    grant.consumed_at = security.now()
    db.add(user)
    try:
        db.flush()
        ensure_default_tavern_access_for_user(db, user)
        return build_token_response(user, db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Почта или ник уже используются.') from None


@router.post('/login', response_model=TokenResponse | TwoFactorRequired)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email).with_for_update())
    valid = verify_password(payload.password, user.password_hash if user else security.DUMMY_PASSWORD_HASH)
    if not valid or user is None:
        # Correct passwords remain usable if outsiders exhaust failed attempts.
        enforce_limit('login-failed-account', email, 15, 300)
        raise HTTPException(401, 'Неверная почта или пароль')
    if user.totp_enabled_at:
        if payload.auth_protocol < 2:
            raise HTTPException(426, 'Для входа с 2FA обновите приложение или откройте сайт Квачата.')
        enforce_limit('login-challenge', str(user.id), 20, 300)
        _, token = security.new_challenge(db, 'login', user_id=user.id, security_version=user.security_version)
        db.commit()
        return TwoFactorRequired(challenge_token=token)
    return build_token_response(user, db)


@router.post('/login/verify', response_model=TokenResponse)
def verify_login(payload: CodeRequest, db: Session = Depends(get_db)):
    preliminary = security.get_challenge(db, payload.challenge_token, 'login', lock=False)
    user = security.locked_user(db, preliminary.user_id)
    challenge = security.get_challenge(db, payload.challenge_token, 'login')
    if challenge.security_version != user.security_version:
        raise HTTPException(400, 'Настройки безопасности изменились. Войдите заново.')
    if not security.use_second_factor(db, user, payload.code):
        security.reject_attempt(db, challenge)
    challenge.consumed_at = security.now()
    return build_token_response(user, db)


def session_id(credentials):
    return UUID(decode_access_token(credentials.credentials, get_settings().secret_key)['sid'])


def security_user(db, current_user, credentials):
    user = security.locked_user(db, current_user.id)
    sid = session_id(credentials)
    session = db.get(AuthSession, sid, populate_existing=True)
    if not session or session.revoked_at or session.expires_at <= security.now():
        raise HTTPException(401, 'Сессия завершена. Войдите заново.')
    return user, sid


@router.get('/security')
def get_security(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {'email_verified': bool(current_user.email_verified_at),
            'two_factor_enabled': bool(current_user.totp_enabled_at),
            'setup_available': get_settings().email_enabled,
            'recovery_codes_remaining': db.scalar(select(func.count()).select_from(RecoveryCode).where(
                RecoveryCode.user_id == current_user.id, RecoveryCode.used_at.is_(None)))}


@router.post('/totp/setup')
def setup_totp(payload: PasswordRequest, current_user: User = Depends(get_current_user),
               credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)):
    require_mail()
    user, sid = security_user(db, current_user, credentials)
    security.check_password(user, payload.password)
    if user.totp_enabled_at:
        raise HTTPException(409, 'Двухфакторная защита уже включена.')
    db.execute(update(AuthChallenge).where(AuthChallenge.user_id == user.id,
        AuthChallenge.purpose == 'totp_setup').values(consumed_at=security.now(), secret=None))
    secret = pyotp.random_base32()
    _, token = security.new_challenge(db, 'totp_setup', seconds=600, user_id=user.id,
        session_id=sid, security_version=user.security_version, secret=security.encrypt(secret))
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name='Квачат')
    png = BytesIO()
    segno.make(uri, micro=False).save(png, kind='png', scale=5)
    db.commit()
    return {'challenge_token': token, 'secret': secret,
            'qr_data_url': 'data:image/png;base64,' + base64.b64encode(png.getvalue()).decode(), 'expires_in': 600}


@router.post('/totp/confirm')
def confirm_totp(payload: CodeRequest, current_user: User = Depends(get_current_user),
                 credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)):
    require_mail()
    user, sid = security_user(db, current_user, credentials)
    challenge = security.get_challenge(db, payload.challenge_token, 'totp_setup')
    if challenge.user_id != user.id or challenge.session_id != sid or challenge.security_version != user.security_version or user.totp_enabled_at:
        raise HTTPException(400, 'Начните настройку защиты заново.')
    step = security.totp_step(security.decrypt(challenge.secret), payload.code, -1)
    if step is None:
        security.reject_attempt(db, challenge)
    user.totp_secret = challenge.secret
    user.totp_enabled_at = security.now()
    user.totp_last_step = step
    codes = security.replace_recovery_codes(db, user)
    security.security_changed(db, user, sid)
    security_notice(db, user, 'Двухфакторная защита включена. Другие сессии завершены.')
    db.commit()
    return {'recovery_codes': codes}


def authorize_security_change(db, current_user, credentials, payload):
    require_mail()
    user, sid = security_user(db, current_user, credentials)
    security.check_password(user, payload.password)
    if not security.use_second_factor(db, user, payload.code):
        raise HTTPException(400, 'Неверный или уже использованный код.')
    return user, sid


@router.post('/totp/disable', status_code=204)
def disable_totp(payload: SecurityActionRequest, current_user: User = Depends(get_current_user),
                 credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)):
    user, sid = authorize_security_change(db, current_user, credentials, payload)
    user.totp_secret = None
    user.totp_enabled_at = None
    user.totp_last_step = -1
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    security.security_changed(db, user, sid)
    security_notice(db, user, 'Двухфакторная защита отключена. Другие сессии завершены.')
    db.commit()
    return Response(status_code=204)


@router.post('/totp/recovery-codes')
def renew_codes(payload: SecurityActionRequest, current_user: User = Depends(get_current_user),
                credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)):
    user, sid = authorize_security_change(db, current_user, credentials, payload)
    codes = security.replace_recovery_codes(db, user)
    security.security_changed(db, user, sid)
    security_notice(db, user, 'Резервные коды заменены. Прежние коды недействительны, другие сессии завершены.')
    db.commit()
    return {'recovery_codes': codes}


@router.post('/logout', status_code=204)
def logout(current_user: User = Depends(get_current_user), credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
           db: Session = Depends(get_db)):
    user, sid = security_user(db, current_user, credentials)
    db.execute(update(AuthSession).where(AuthSession.id == sid).values(revoked_at=security.now()))
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id, PushSubscription.session_id == sid))
    db.commit()
    return Response(status_code=204)


@router.post('/logout-all', status_code=204)
def logout_all(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = security.locked_user(db, current_user.id)
    security.revoke_sessions(db, user.id)
    user.security_version += 1
    db.commit()
    return Response(status_code=204)
