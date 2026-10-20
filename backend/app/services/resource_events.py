"""Invalidate public/profile/economy views after successful mutations, without data payloads."""
import logging
from app.services.event_bus import distributed_event


@distributed_event
async def resources_changed():
    from app.services.app_events import app_event_manager
    await app_event_manager.broadcast({'type': 'resources_changed'})


class ResourceEventsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        changed = False
        path = scope.get('path', '')
        relevant = (path.startswith('/api/me/') or path == '/api/me' or any(path.startswith('/api/' + p)
                    for p in ('inventory', 'wallet', 'shop', 'wallpapers', 'friends', 'admin/directory', 'admin/wallets')))

        async def capture(message):
            nonlocal changed
            if message['type'] == 'http.response.start':
                changed = 200 <= message['status'] < 300
            await send(message)

        await self.app(scope, receive, capture)
        if scope['type'] == 'http' and scope['method'] in {'POST', 'PUT', 'PATCH', 'DELETE'} and relevant and changed and not path.endswith('/preview'):
            try:
                await resources_changed()
            except Exception:
                logging.getLogger(__name__).warning('Resource invalidation deferred to client resync')
