import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from app.services.app_events import AppEventConnection, AppEventManager


def test_event_dates_and_ids_do_not_disconnect_subscriber():
    async def scenario():
        class Socket:
            def __init__(self):
                self.sent = []
                self.closed = False

            async def send_json(self, value):
                self.sent.append(json.loads(json.dumps(value)))

            async def close(self, **kwargs):
                self.closed = True

        socket = Socket()
        manager = AppEventManager()
        manager._connections['user'] = {'connection': AppEventConnection(socket)}
        stamp = datetime(2026, 10, 16, tzinfo=timezone.utc)
        message_id = uuid4()
        await manager._send_payload([('user', 'connection', socket)], {
            'type': 'message_read_updated', 'state': {'read_at': stamp, 'message_id': message_id},
        })
        await manager._send_payload([('user', 'connection', socket)], {'type': 'message_created'})
        assert not socket.closed
        assert socket.sent[0]['state'] == {'read_at': stamp.isoformat(), 'message_id': str(message_id)}
        assert socket.sent[1]['type'] == 'message_created'

    asyncio.run(scenario())
