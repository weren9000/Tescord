from __future__ import annotations

from hashlib import sha256
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, status
from fastapi import UploadFile
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies.auth import get_current_user
from app.db.models import Attachment, Channel, ChannelType, Message, MessageType, User
from app.db.session import get_db
from app.schemas.workspace import (
    ChannelMessageSummary,
    ChannelMessagesPage,
    MessageAttachmentSummary,
    MessageAuthorSummary,
)
from app.services.app_events import publish_message_created
from app.services.voice_access import can_view_voice_channel, get_voice_channel_access

router = APIRouter(tags=["messages"])

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 50
MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024


def _build_author_summary(user: User) -> MessageAuthorSummary:
    return MessageAuthorSummary(
        id=user.id,
        login=user.email,
        nick=user.username,
        full_name=user.display_name,
        character_name=user.bio,
    )


def _build_attachment_summary(attachment: Attachment) -> MessageAttachmentSummary:
    return MessageAttachmentSummary(
        id=attachment.id,
        filename=attachment.filename,
        mime_type=attachment.mime_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at,
    )


def _build_message_summary(message: Message) -> ChannelMessageSummary:
    return ChannelMessageSummary(
        id=message.id,
        channel_id=message.channel_id,
        type=message.type.value,
        content=message.content,
        created_at=message.created_at,
        edited_at=message.edited_at,
        author=_build_author_summary(message.author),
        attachments=[_build_attachment_summary(attachment) for attachment in message.attachments],
    )


def _sanitize_filename(filename: str | None) -> str:
    if not filename:
        return "file"

    sanitized = filename.replace("\\", "/").split("/")[-1].strip()
    return sanitized or "file"


def _get_accessible_message_channel(db: Session, channel_id: UUID, current_user: User) -> Channel:
    channel = db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    if channel.type not in {ChannelType.TEXT, ChannelType.VOICE}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сообщения доступны только в текстовых и голосовых каналах",
        )

    if channel.type == ChannelType.VOICE:
        access = get_voice_channel_access(db, channel.id, current_user.id)
        if not can_view_voice_channel(access):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    return channel


def _load_message(db: Session, message_id: UUID) -> Message | None:
    return db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(joinedload(Message.author), selectinload(Message.attachments))
    ).unique().scalar_one_or_none()


@router.get("/channels/{channel_id}/messages", response_model=ChannelMessagesPage)
def list_channel_messages(
    channel_id: UUID,
    before: UUID | None = Query(default=None),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelMessagesPage:
    channel = _get_accessible_message_channel(db, channel_id, current_user)

    statement = (
        select(Message)
        .where(Message.channel_id == channel.id)
        .options(joinedload(Message.author), selectinload(Message.attachments))
        .order_by(Message.created_at.desc(), Message.id.desc())
    )

    if before is not None:
        cursor_message = db.get(Message, before)
        if cursor_message is None or cursor_message.channel_id != channel.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Курсор сообщений не найден")

        statement = statement.where(
            or_(
                Message.created_at < cursor_message.created_at,
                and_(Message.created_at == cursor_message.created_at, Message.id < cursor_message.id),
            )
        )

    rows = db.execute(statement.limit(limit + 1)).unique().scalars().all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    next_before = page_rows[-1].id if has_more and page_rows else None

    return ChannelMessagesPage(
        items=[_build_message_summary(message) for message in reversed(page_rows)],
        has_more=has_more,
        next_before=next_before,
    )


@router.post("/channels/{channel_id}/messages", response_model=ChannelMessageSummary, status_code=status.HTTP_201_CREATED)
async def create_channel_message(
    channel_id: UUID,
    content: str = Form(default=""),
    files: list[UploadFile] | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelMessageSummary:
    channel = _get_accessible_message_channel(db, channel_id, current_user)

    normalized_content = content.strip()
    uploads = [upload for upload in (files or []) if upload.filename]
    if not normalized_content and not uploads:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нужно отправить текст сообщения или хотя бы один файл",
        )

    message = Message(
        channel_id=channel.id,
        author_id=current_user.id,
        content=normalized_content,
        type=MessageType.TEXT,
    )
    db.add(message)
    db.flush()

    try:
        for upload in uploads:
            payload = await upload.read()
            if len(payload) > MAX_ATTACHMENT_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Файл {upload.filename!r} превышает лимит 50 МБ",
                )

            attachment = Attachment(
                message_id=message.id,
                filename=_sanitize_filename(upload.filename),
                mime_type=upload.content_type or "application/octet-stream",
                size_bytes=len(payload),
                checksum_sha256=sha256(payload).hexdigest(),
                content=payload,
            )
            db.add(attachment)
    finally:
        for upload in uploads:
            await upload.close()

    db.commit()

    created_message = _load_message(db, message.id)
    if created_message is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Сообщение не удалось загрузить")

    message_summary = _build_message_summary(created_message)
    await publish_message_created(channel.server_id, message_summary.model_dump(mode="json"))
    return message_summary


@router.get("/attachments/{attachment_id}")
def download_attachment(
    attachment_id: UUID,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(attachment.filename)}",
        "Content-Length": str(attachment.size_bytes),
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=attachment.content, media_type=attachment.mime_type, headers=headers)
