"""Keyed n-grams narrow candidates; decrypted matching removes false positives.

The index reveals repeated grams/frequency, not plaintext. It is not E2EE.
Old and new key ids coexist during rotation.
"""
from sqlalchemy import and_, or_, select, tuple_
from app.db.models import Message, MessageType
from app.services.data_encryption import query_tokens


def search_message_ids(db, channel_id, terms: list[str], limit: int, *, base_statement=None):
    normalized = [term.casefold() for term in terms]
    escaped = [term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') for term in terms]
    legacy = and_(Message.encrypted_content.is_(None),
                  *(Message.legacy_content.ilike(f'%{term}%', escape='\\') for term in escaped))
    encrypted = [Message.search_tokens.contains(tokens) for tokens in query_tokens(terms)]
    statement = base_statement if base_statement is not None else select(Message).where(Message.channel_id == channel_id)
    statement = statement.where(Message.type == MessageType.TEXT, or_(legacy, *encrypted))
    found, cursor = [], None
    while len(found) < limit:
        page = statement
        if cursor is not None:
            page = page.where(tuple_(Message.created_at, Message.id) < cursor)
        rows = db.scalars(page.order_by(Message.created_at.desc(), Message.id.desc()).limit(200)).all()
        if not rows:
            break
        for row in rows:
            if all(term in row.content.casefold() for term in normalized):
                found.append(row.id)
                if len(found) == limit:
                    break
        cursor = (rows[-1].created_at, rows[-1].id)
    return found
