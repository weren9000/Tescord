from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from datetime import datetime, timezone, timedelta
from uuid import UUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy import update
from app.api.dependencies.auth import bearer_scheme, get_current_user
from app.core.security import decode_access_token
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import AuthSession, User
from app.db.session import get_db
from app.schemas.auth import AuthUserResponse, LoginRequest, RegisterRequest, TokenResponse
from app.services.default_tavern import ensure_default_tavern_access_for_user
from app.services.user_public_id import generate_next_public_user_id
from app.services.rate_limits import enforce_limit

router = APIRouter(prefix="/auth", tags=["auth"])


def build_token_response(user: User, db: Session) -> TokenResponse:
    settings = get_settings()
    session = AuthSession(user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes))
    db.add(session)
    db.commit()
    db.refresh(session)
    return TokenResponse(
        access_token=create_access_token(str(user.id), settings.secret_key, settings.access_token_expire_minutes, session_id=str(session.id)),
        user=AuthUserResponse.from_user(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    nick = payload.nick.strip()

    if payload.password != payload.password_confirmation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароли не совпадают")

    # Serialize registration before checking case-insensitive uniqueness as well as IDs.
    public_id = generate_next_public_user_id(db)
    existing_user = db.execute(
        select(User).where(or_(func.lower(User.email) == email, func.lower(User.username) == nick.lower()))
    ).scalar_one_or_none()

    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с такой почтой или ником уже существует",
        )

    user = User(
        public_id=public_id,
        email=email,
        username=nick,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.flush()
        ensure_default_tavern_access_for_user(db, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Почта или ник уже заняты") from exc
    db.refresh(user)
    return build_token_response(user, db)


@router.post("/login", response_model=TokenResponse)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    enforce_limit("login-account", email, 15, 300)
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверная почта или пароль")

    return build_token_response(user, db)


@router.post("/logout", status_code=204)
def logout(current_user: User = Depends(get_current_user), credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)) -> Response:
    payload = decode_access_token(credentials.credentials, get_settings().secret_key)
    db.execute(update(AuthSession).where(AuthSession.id == UUID(payload["sid"]), AuthSession.user_id == current_user.id).values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    return Response(status_code=204)


@router.post("/logout-all", status_code=204)
def logout_all(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    db.execute(update(AuthSession).where(AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    return Response(status_code=204)
