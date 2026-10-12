"""Authorization at the delivery boundary, including already-open subscriptions."""
from uuid import UUID

from sqlalchemy import select

from app.db.models import Channel, ChannelType, ServerBlock, ServerMember, VoiceChannelAccess
from app.db.session import SessionLocal
from app.services.voice_access import can_view_voice_channel


def allowed_event_user_ids(server_id: str, user_ids: set[str], channel_id: str | None = None) -> set[str]:
    try:
        server_uuid = UUID(server_id)
        users = [UUID(value) for value in user_ids]
        channel_uuid = UUID(channel_id) if channel_id else None
    except (ValueError, TypeError, AttributeError):
        return set()
    if not users:
        return set()
    with SessionLocal() as db:
        memberships = db.execute(select(ServerMember).where(
            ServerMember.server_id == server_uuid, ServerMember.user_id.in_(users),
        )).scalars().all()
        blocked = set(db.execute(select(ServerBlock.user_id).where(
            ServerBlock.server_id == server_uuid, ServerBlock.user_id.in_(users),
        )).scalars())
        channel = db.get(Channel, channel_uuid) if channel_uuid else None
        if channel_uuid and (channel is None or channel.server_id != server_uuid):
            return set()
        access = {}
        if channel is not None and channel.type == ChannelType.VOICE:
            access = {row.user_id: row for row in db.execute(select(VoiceChannelAccess).where(
                VoiceChannelAccess.channel_id == channel.id, VoiceChannelAccess.user_id.in_(users),
            )).scalars()}
        return {
            str(member.user_id) for member in memberships
            if member.user_id not in blocked and (
                channel is None or channel.type != ChannelType.VOICE
                or can_view_voice_channel(access.get(member.user_id), member.role)
            )
        }
