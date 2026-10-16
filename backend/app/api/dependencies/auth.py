from __future__ import annotations

from uuid import UUID
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import TokenError, decode_access_token
from app.db.models import AuthSession, User
from app.db.session import get_db, SessionLocal

bearer_scheme = HTTPBearer(auto_error=False)


def resolve_user_from_token(token: str, db: Session) -> User:
    try:
        payload = decode_access_token(token, get_settings().secret_key)
        user_id = UUID(str(payload["sub"]))
        session_id = UUID(str(payload["sid"]))
    except (KeyError, ValueError, TokenError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный access token") from exc

    session = db.get(AuthSession, session_id)
    if session is None or session.user_id != user_id or session.revoked_at is not None or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired or revoked")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")

    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")

    # Release the authentication checkout before FastAPI resumes an async route.
    # Otherwise concurrent dependencies can fill the pool while an async handler
    # blocks the event loop waiting for its own synchronous ORM connection.
    with SessionLocal() as auth_db:
        user = resolve_user_from_token(credentials.credentials, auth_db)
        auth_db.expunge(user)
    # Keep profile edits attached to the request session without issuing a query.
    return db.merge(user, load=False)
