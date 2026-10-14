from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import ServerMember, User
from app.db.session import get_db
from app.schemas.users import CurrentUserResponse, UpdateCurrentUserProfileResponse
from app.services.app_events import publish_members_updated_from_sync, publish_voice_presence_updated_from_sync
from app.services.avatar_presets import AVATAR_PRESETS, AVATAR_DIRECTORY
from app.services.inventory import lock_inventory, asset_path
from app.services.avatar_frames import frame_svg
from app.db.inventory import InventoryItem
from sqlalchemy import update

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
def read_current_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> CurrentUserResponse:
    result = CurrentUserResponse.from_user(current_user)
    result.avatar_item_id = db.scalar(select(InventoryItem.id).where(
        InventoryItem.owner_id == current_user.id, InventoryItem.kind == 'avatar',
        InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False)))
    return result


@router.put("/me/profile", response_model=UpdateCurrentUserProfileResponse)
async def update_current_user_profile(
    avatar: UploadFile | None = File(default=None),
    remove_avatar: bool = Form(default=False),
    avatar_preset: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UpdateCurrentUserProfileResponse:
    if avatar is not None and not current_user.is_avatar_admin:
        await avatar.close()
        raise HTTPException(403, 'Загрузка аватарок доступна только администратору аватарок')
    if sum((avatar is not None, remove_avatar, avatar_preset is not None)) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Выберите одно действие: загрузка, удаление или готовый аватар",
        )

    if avatar_preset is not None and avatar_preset not in AVATAR_PRESETS:
        raise HTTPException(status_code=400, detail="Неизвестный аватар")

    lock_inventory(db)
    db.refresh(current_user)
    if remove_avatar or avatar_preset is not None or avatar is not None:
        db.execute(update(InventoryItem).where(InventoryItem.owner_id == current_user.id,
                   InventoryItem.kind == 'avatar').values(equipped=False))

    if remove_avatar or avatar_preset is not None:
        current_user.avatar_filename = None
        current_user.avatar_mime_type = None
        current_user.avatar_size_bytes = None
        current_user.avatar_content = None
        current_user.avatar_updated_at = datetime.now(timezone.utc)
        if avatar_preset is not None:
            current_user.avatar_preset = avatar_preset

    if avatar is not None:
        try:
            if (avatar.content_type or "").lower() not in ALLOWED_AVATAR_MIME_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Поддерживаются только PNG и JPG аватарки",
                )

            payload = await avatar.read(MAX_AVATAR_SIZE_BYTES + 1)
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
def read_user_avatar(user_id: UUID, motion: bool = True, include_frame: bool = True, db: Session = Depends(get_db)) -> Response:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аватарка не найдена")
    equipped = db.scalar(select(InventoryItem).where(InventoryItem.owner_id == user.id,
        InventoryItem.kind == 'avatar', InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False)))
    frame = db.scalar(select(InventoryItem).where(InventoryItem.owner_id == user.id,
        InventoryItem.kind == 'frame', InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False)))
    if frame and include_frame:
        if equipped:
            content, mime = asset_path(equipped.catalog_id).read_bytes(), 'image/webp'
        elif user.avatar_content is not None and user.avatar_mime_type is not None:
            content, mime = user.avatar_content, user.avatar_mime_type
        else:
            content, mime = (AVATAR_DIRECTORY / (user.avatar_preset+'.webp')).read_bytes(), 'image/webp'
        return Response(frame_svg(frame.catalog_id, content, mime, motion=motion), media_type='image/svg+xml',
                        headers={'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'})
    if equipped:
        return FileResponse(asset_path(equipped.catalog_id), media_type='image/webp',
                            headers={'Cache-Control': 'no-cache'})
    if user.avatar_content is None or user.avatar_mime_type is None:
        return read_avatar_preset(user.avatar_preset)

    filename = user.avatar_filename or "avatar"
    return Response(
        content=user.avatar_content,
        media_type=user.avatar_mime_type,
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
        },
    )


@router.get("/avatar-presets/{preset}")
def read_avatar_preset(preset: str) -> Response:
    if preset not in AVATAR_PRESETS:
        raise HTTPException(status_code=404, detail="Аватар не найден")
    return FileResponse(AVATAR_DIRECTORY / f'{preset}.webp', media_type='image/webp',
                        headers={'Cache-Control': 'public, max-age=300'})
