from fastapi import APIRouter

from app.api.routes.attention import router as attention_router
from app.api.routes.auth import router as auth_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.direct_calls import router as direct_calls_router
from app.api.routes.events import router as events_router
from app.api.routes.friends import router as friends_router
from app.api.routes.health import router as health_router
from app.api.routes.messages import router as messages_router
from app.api.routes.presence import router as presence_router
from app.api.routes.push import router as push_router
from app.api.routes.servers import router as servers_router
from app.api.routes.users import router as users_router
from app.api.routes.voice import router as voice_router

api_router = APIRouter()
api_router.include_router(attention_router)
api_router.include_router(auth_router)
api_router.include_router(conversations_router)
api_router.include_router(direct_calls_router)
api_router.include_router(events_router)
api_router.include_router(friends_router)
api_router.include_router(health_router)
api_router.include_router(users_router)
api_router.include_router(presence_router)
api_router.include_router(push_router)
api_router.include_router(servers_router)
api_router.include_router(messages_router)
api_router.include_router(voice_router)
