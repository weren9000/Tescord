from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, status
from fastapi import UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies.auth import get_current_user
from app.db.models import (
    Attachment,
    Channel,
    ChannelReadState,
    ChannelType,
    Message,
    MessageReaction,
    MessageReactionKind,
    MessageType,
    ServerKind,
    User,
)
from app.db.session import get_db
from app.schemas.workspace import (
    ChannelMessageSummary,
    ChannelMessagesPage,
    ChannelReadStateSummary,
    MarkChannelReadRequest,
    MessageAttachmentSummary,
    MessageAuthorSummary,
    MessageReactionSummary,
    MessageReadUserSummary,
    MessageReactionsSnapshot,
    MessageReplySummary,
)
from app.services.app_events import (
    publish_message_created,
    publish_message_read_updated,
    publish_message_reactions_updated,
)
from app.services.attachment_storage import (
    AttachmentTooLargeError,
    delete_stored_attachment,
    resolve_attachment_path,
    store_upload_file,
)
from app.services.server_access import ensure_channel_server_access
from app.services.voice_access import can_view_voice_channel, get_voice_channel_access

router = APIRouter(tags=["messages"])

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 50
MAX_ATTACHMENT_SIZE_BYTES = 500 * 1024 * 1024
MESSAGE_REACTION_ORDER: tuple[MessageReactionKind, ...] = (
    MessageReactionKind.HEART,
    MessageReactionKind.LIKE,
    MessageReactionKind.DISLIKE,
    MessageReactionKind.ANGRY,
    MessageReactionKind.CRY,
    MessageReactionKind.CONFUSED,
    MessageReactionKind.DISPLEASED,
    MessageReactionKind.LAUGH,
    MessageReactionKind.FIRE,
    MessageReactionKind.WOW,
    MessageReactionKind.PRAYING_CAT,
)


def _build_author_summary(user: User) -> MessageAuthorSummary:
    return MessageAuthorSummary(
        id=user.id,
        public_id=user.public_id,
        login=user.email,
        nick=user.username,
        avatar_updated_at=user.avatar_updated_at,
    )


def _build_read_user_summary(user: User) -> MessageReadUserSummary:
    return MessageReadUserSummary(
        id=user.id,
        public_id=user.public_id,
        nick=user.username,
        avatar_updated_at=user.avatar_updated_at,
    )


def _build_attachment_summary(attachment: Attachment) -> MessageAttachmentSummary:
    return MessageAttachmentSummary(
        id=attachment.id,
        filename=attachment.filename,
        mime_type=attachment.mime_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at,
    )


def _build_reply_summary(message: Message | None) -> MessageReplySummary | None:
    if message is None:
        return None

    return MessageReplySummary(
        id=message.id,
        content=message.content,
        created_at=message.created_at,
        author=_build_author_summary(message.author),
        attachments_count=len(message.attachments),
    )


def _build_reaction_summaries(message: Message, current_user_id: UUID) -> list[MessageReactionSummary]:
    counts_by_code: dict[str, int] = {}
    reacted_codes: set[str] = set()

    for reaction in message.reactions:
        code = reaction.reaction.value
        counts_by_code[code] = counts_by_code.get(code, 0) + 1
        if reaction.user_id == current_user_id:
            reacted_codes.add(code)

    return [
        MessageReactionSummary(
            code=reaction_kind.value,
            count=counts_by_code[reaction_kind.value],
            reacted=reaction_kind.value in reacted_codes,
        )
        for reaction_kind in MESSAGE_REACTION_ORDER
        if counts_by_code.get(reaction_kind.value)
    ]


def _build_message_summary(message: Message, current_user_id: UUID) -> ChannelMessageSummary:
    read_by = [
        _build_read_user_summary(read_state.user)
        for read_state in sorted(
            message.read_states,
            key=lambda item: item.last_read_at,
            reverse=True,
        )
        if read_state.user_id != message.author_id
    ]

    return ChannelMessageSummary(
        id=message.id,
        channel_id=message.channel_id,
        type=message.type.value,
        content=message.content,
        created_at=message.created_at,
        edited_at=message.edited_at,
        author=_build_author_summary(message.author),
        reply_to=_build_reply_summary(message.reply_to),
        attachments=[_build_attachment_summary(attachment) for attachment in message.attachments],
        reactions=_build_reaction_summaries(message, current_user_id),
        read_by=read_by,
    )


def _build_message_reactions_snapshot(message: Message, current_user_id: UUID) -> MessageReactionsSnapshot:
    return MessageReactionsSnapshot(
        message_id=message.id,
        channel_id=message.channel_id,
        reactions=_build_reaction_summaries(message, current_user_id),
    )


def _build_message_reactions_event_snapshot(message: Message) -> MessageReactionsSnapshot:
    counts_by_code: dict[str, int] = {}
    for reaction in message.reactions:
        code = reaction.reaction.value
        counts_by_code[code] = counts_by_code.get(code, 0) + 1

    return MessageReactionsSnapshot(
        message_id=message.id,
        channel_id=message.channel_id,
        reactions=[
            MessageReactionSummary(code=reaction_kind.value, count=counts_by_code[reaction_kind.value], reacted=False)
            for reaction_kind in MESSAGE_REACTION_ORDER
            if counts_by_code.get(reaction_kind.value)
        ],
    )


def _build_channel_read_state_summary(read_state: ChannelReadState) -> ChannelReadStateSummary:
    return ChannelReadStateSummary(
        channel_id=read_state.channel_id,
        user_id=read_state.user_id,
        last_read_message_id=read_state.last_read_message_id,
        last_read_at=read_state.last_read_at,
    )


def _build_channel_read_event_payload(read_state: ChannelReadState, user: User) -> dict[str, object | None]:
    payload = _build_channel_read_state_summary(read_state).model_dump(mode="json")
    payload["nick"] = user.username
    payload["public_id"] = user.public_id
    payload["avatar_updated_at"] = user.avatar_updated_at
    return payload


def _sanitize_filename(filename: str | None) -> str:
    if not filename:
        return "file"

    sanitized = filename.replace("\\", "/").split("/")[-1].strip()
    return sanitized or "file"


def _message_sort_key(message: Message) -> tuple[datetime, str]:
    return message.created_at.astimezone(timezone.utc), str(message.id)


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


def _message_load_options():
    return (
        joinedload(Message.author),
        joinedload(Message.channel),
        joinedload(Message.reply_to).joinedload(Message.author),
        joinedload(Message.reply_to).selectinload(Message.attachments),
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.read_states).joinedload(ChannelReadState.user),
    )


def _conversation_safe_accessible_message_channel(db: Session, channel_id: UUID, current_user: User) -> Channel:
    channel = db.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    if channel.type not in {ChannelType.TEXT, ChannelType.VOICE}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сообщения доступны только в текстовых и голосовых каналах",
        )

    server, _ = ensure_channel_server_access(db, channel, current_user)
    if server.kind in {ServerKind.DIRECT, ServerKind.GROUP_CHAT} and channel.type != ChannelType.TEXT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    if channel.type == ChannelType.VOICE:
        access = get_voice_channel_access(db, channel.id, current_user.id)
        if not can_view_voice_channel(access):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")

    return channel


_get_accessible_message_channel = _conversation_safe_accessible_message_channel


def _load_message(db: Session, message_id: UUID) -> Message | None:
    return db.execute(
        select(Message).where(Message.id == message_id).options(*_message_load_options())
    ).unique().scalar_one_or_none()


def _get_accessible_message(db: Session, message_id: UUID, current_user: User) -> Message:
    message = _load_message(db, message_id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")

    _get_accessible_message_channel(db, message.channel_id, current_user)
    return message


def _parse_message_reaction_kind(reaction_code: str) -> MessageReactionKind:
    try:
        return MessageReactionKind(reaction_code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестная реакция") from exc


def _resolve_target_read_message(
    db: Session,
    channel: Channel,
    last_message_id: UUID | None,
) -> Message | None:
    if last_message_id is not None:
        target_message = db.get(Message, last_message_id)
        if target_message is None or target_message.channel_id != channel.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение для отметки прочтения не найдено")
        return target_message

    return db.execute(
        select(Message)
        .where(Message.channel_id == channel.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
    ).scalar_one_or_none()


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
        .options(*_message_load_options())
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
        items=[_build_message_summary(message, current_user.id) for message in reversed(page_rows)],
        has_more=has_more,
        next_before=next_before,
    )


@router.post("/channels/{channel_id}/messages", response_model=ChannelMessageSummary, status_code=status.HTTP_201_CREATED)
async def create_channel_message(
    channel_id: UUID,
    content: str = Form(default=""),
    reply_to_message_id: UUID | None = Form(default=None),
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

    reply_to_message: Message | None = None
    if reply_to_message_id is not None:
        reply_to_message = db.get(Message, reply_to_message_id)
        if reply_to_message is None or reply_to_message.channel_id != channel.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение для ответа не найдено")

    message = Message(
        channel_id=channel.id,
        author_id=current_user.id,
        reply_to_message_id=reply_to_message.id if reply_to_message else None,
        content=normalized_content,
        type=MessageType.TEXT,
    )
    db.add(message)
    db.flush()

    created_storage_paths: list[str] = []
    try:
        for upload in uploads:
            attachment_id = uuid4()
            sanitized_filename = _sanitize_filename(upload.filename)
            try:
                stored_attachment = await store_upload_file(
                    upload,
                    attachment_id=attachment_id,
                    filename=sanitized_filename,
                    max_size_bytes=MAX_ATTACHMENT_SIZE_BYTES,
                )
            except AttachmentTooLargeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Файл {upload.filename!r} превышает лимит 500 МБ",
                ) from exc

            created_storage_paths.append(stored_attachment.storage_path)

            attachment = Attachment(
                id=attachment_id,
                message_id=message.id,
                filename=stored_attachment.filename,
                mime_type=stored_attachment.mime_type,
                size_bytes=stored_attachment.size_bytes,
                checksum_sha256=stored_attachment.checksum_sha256,
                storage_path=stored_attachment.storage_path,
                content=None,
            )
            db.add(attachment)

        db.commit()
    except HTTPException:
        db.rollback()
        for storage_path in created_storage_paths:
            delete_stored_attachment(storage_path)
        raise
    except Exception:
        db.rollback()
        for storage_path in created_storage_paths:
            delete_stored_attachment(storage_path)
        raise
    finally:
        for upload in uploads:
            await upload.close()

    created_message = _load_message(db, message.id)
    if created_message is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Сообщение не удалось загрузить")

    message_summary = _build_message_summary(created_message, current_user.id)
    await publish_message_created(channel.server_id, message_summary.model_dump(mode="json"))
    return message_summary


@router.post("/channels/{channel_id}/read", response_model=ChannelReadStateSummary)
async def mark_channel_read(
    channel_id: UUID,
    payload: MarkChannelReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelReadStateSummary:
    channel = _get_accessible_message_channel(db, channel_id, current_user)
    target_message = _resolve_target_read_message(db, channel, payload.last_message_id)

    read_state = db.execute(
        select(ChannelReadState).where(
            ChannelReadState.channel_id == channel.id,
            ChannelReadState.user_id == current_user.id,
        )
    ).scalar_one_or_none()

    should_publish = False
    now = datetime.now(timezone.utc)

    if read_state is None:
        read_state = ChannelReadState(
            channel_id=channel.id,
            user_id=current_user.id,
            last_read_message_id=target_message.id if target_message else None,
            last_read_at=now,
        )
        db.add(read_state)
        should_publish = target_message is not None
    else:
        existing_message = read_state.last_read_message
        next_message = target_message

        if next_message is not None and (
            existing_message is None or _message_sort_key(next_message) >= _message_sort_key(existing_message)
        ):
            if read_state.last_read_message_id != next_message.id:
                read_state.last_read_message_id = next_message.id
                should_publish = True
            read_state.last_read_at = now
        elif existing_message is None and next_message is None:
            read_state.last_read_at = now

    db.commit()

    refreshed_state = db.execute(
        select(ChannelReadState)
        .where(ChannelReadState.channel_id == channel.id, ChannelReadState.user_id == current_user.id)
        .options(joinedload(ChannelReadState.user), joinedload(ChannelReadState.last_read_message))
    ).scalar_one()

    if should_publish:
        await publish_message_read_updated(
            channel.server_id,
            channel.id,
            _build_channel_read_event_payload(refreshed_state, current_user),
        )

    return _build_channel_read_state_summary(refreshed_state)


@router.put("/messages/{message_id}/reactions/{reaction_code}", response_model=MessageReactionsSnapshot)
async def add_message_reaction(
    message_id: UUID,
    reaction_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageReactionsSnapshot:
    message = _get_accessible_message(db, message_id, current_user)
    reaction_kind = _parse_message_reaction_kind(reaction_code)

    existing_reaction = db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.user_id == current_user.id,
            MessageReaction.reaction == reaction_kind,
        )
    ).scalar_one_or_none()

    if existing_reaction is None:
        db.add(
            MessageReaction(
                message_id=message.id,
                user_id=current_user.id,
                reaction=reaction_kind,
            )
        )
        db.commit()

    updated_message = _load_message(db, message.id)
    if updated_message is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Не удалось обновить реакции")

    snapshot = _build_message_reactions_snapshot(updated_message, current_user.id)
    event_snapshot = _build_message_reactions_event_snapshot(updated_message)
    await publish_message_reactions_updated(
        updated_message.channel.server_id,
        updated_message.channel_id,
        event_snapshot.model_dump(mode="json"),
    )
    return snapshot


@router.delete("/messages/{message_id}/reactions/{reaction_code}", response_model=MessageReactionsSnapshot)
async def remove_message_reaction(
    message_id: UUID,
    reaction_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageReactionsSnapshot:
    message = _get_accessible_message(db, message_id, current_user)
    reaction_kind = _parse_message_reaction_kind(reaction_code)

    existing_reaction = db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.user_id == current_user.id,
            MessageReaction.reaction == reaction_kind,
        )
    ).scalar_one_or_none()

    if existing_reaction is not None:
        db.delete(existing_reaction)
        db.commit()

    updated_message = _load_message(db, message.id)
    if updated_message is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Не удалось обновить реакции")

    snapshot = _build_message_reactions_snapshot(updated_message, current_user.id)
    event_snapshot = _build_message_reactions_event_snapshot(updated_message)
    await publish_message_reactions_updated(
        updated_message.channel.server_id,
        updated_message.channel_id,
        event_snapshot.model_dump(mode="json"),
    )
    return snapshot


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
    if attachment.storage_path:
        file_path = resolve_attachment_path(attachment.storage_path)
        if not file_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")
        return FileResponse(file_path, media_type=attachment.mime_type, headers=headers)

    return Response(content=attachment.content or b"", media_type=attachment.mime_type, headers=headers)
