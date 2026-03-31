from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import AuthUserResponse, LoginRequest, RegisterRequest, TokenResponse
from app.services.default_tavern import ensure_default_tavern_access_for_user
from app.services.user_public_id import generate_next_public_user_id

router = APIRouter(prefix="/auth", tags=["auth"])


def build_token_response(user: User) -> TokenResponse:
    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id), settings.secret_key, settings.access_token_expire_minutes),
        user=AuthUserResponse.from_user(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    nick = payload.nick.strip()

    if payload.password != payload.password_confirmation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароли не совпадают")

    existing_user = db.execute(
        select(User).where(or_(func.lower(User.email) == email, func.lower(User.username) == nick.lower()))
    ).scalar_one_or_none()

    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с такой почтой или ником уже существует",
        )

    user = User(
        public_id=generate_next_public_user_id(db),
        email=email,
        username=nick,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    ensure_default_tavern_access_for_user(db, user)
    db.commit()
    db.refresh(user)
    return build_token_response(user)


@router.post("/login", response_model=TokenResponse)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверная почта или пароль")

    return build_token_response(user)
