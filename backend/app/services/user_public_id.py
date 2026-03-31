from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import User

PUBLIC_USER_ID_MIN = 10000
PUBLIC_USER_ID_MAX = 99999


def generate_next_public_user_id(db: Session) -> int:
    current_max = db.execute(select(func.max(User.public_id))).scalar_one_or_none()
    next_public_id = max(PUBLIC_USER_ID_MIN, (current_max or (PUBLIC_USER_ID_MIN - 1)) + 1)
    if next_public_id > PUBLIC_USER_ID_MAX:
        raise ValueError("Свободные пятизначные ID пользователей закончились")

    return int(next_public_id)
