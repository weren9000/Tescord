from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import ServerMember, User
from app.db.session import get_db
from app.schemas.users import CurrentUserResponse, UpdateCurrentUserProfileResponse
from app.services.app_events import publish_members_updated_from_sync, publish_voice_presence_updated_from_sync

router = APIRouter(tags=["users"])

ALLOWED_AVATAR_MIME_TYPES = {"image/png", "image/jpeg"}
MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024


def _sanitize_filename(filename: str | None) -> str:
    if not filename:
        return "avatar"

    sanitized = filename.replace("\\", "/").split("/")[-1].strip()
    return sanitized or "avatar"


def _publish_profile_updates_for_user(db: Session, user_id: UUID) -> None:
    server_ids = db.execute(select(ServerMember.server_id).where(ServerMember.user_id == user_id)).scalars().all()
    for server_id in server_ids:
        publish_members_updated_from_sync(server_id, reason="profile_updated")
        publish_voice_presence_updated_from_sync(server_id)


@router.get("/me", response_model=CurrentUserResponse)
def read_current_user(current_user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse.from_user(current_user)


@router.put("/me/profile", response_model=UpdateCurrentUserProfileResponse)
async def update_current_user_profile(
    character_name: str = Form(..., min_length=2, max_length=64),
    avatar: UploadFile | None = File(default=None),
    remove_avatar: bool = Form(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UpdateCurrentUserProfileResponse:
    normalized_character_name = character_name.strip()
    if len(normalized_character_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя персонажа должно быть не короче 2 символов",
        )

    if avatar is not None and remove_avatar:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя одновременно загрузить и удалить аватарку",
        )

    current_user.bio = normalized_character_name

    if remove_avatar:
        current_user.avatar_filename = None
        current_user.avatar_mime_type = None
        current_user.avatar_size_bytes = None
        current_user.avatar_content = None
        current_user.avatar_updated_at = None

    if avatar is not None:
        try:
            if (avatar.content_type or "").lower() not in ALLOWED_AVATAR_MIME_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Поддерживаются только PNG и JPG аватарки",
                )

            payload = await avatar.read()
            if len(payload) > MAX_AVATAR_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Аватарка превышает лимит 2 МБ",
                )

            current_user.avatar_filename = _sanitize_filename(avatar.filename)
            current_user.avatar_mime_type = (avatar.content_type or "application/octet-stream").lower()
            current_user.avatar_size_bytes = len(payload)
            current_user.avatar_content = payload
            current_user.avatar_updated_at = datetime.now(timezone.utc)
        finally:
            await avatar.close()

    db.commit()
    db.refresh(current_user)
    _publish_profile_updates_for_user(db, current_user.id)
    return UpdateCurrentUserProfileResponse.from_user(current_user)


@router.get("/users/{user_id}/avatar")
def read_user_avatar(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    del current_user

    user = db.get(User, user_id)
    if user is None or user.avatar_content is None or user.avatar_mime_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аватарка не найдена")

    filename = user.avatar_filename or "avatar"
    return Response(
        content=user.avatar_content,
        media_type=user.avatar_mime_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
        },
    )
