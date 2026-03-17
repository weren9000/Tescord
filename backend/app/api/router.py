from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.messages import router as messages_router
from app.api.routes.presence import router as presence_router
from app.api.routes.servers import router as servers_router
from app.api.routes.users import router as users_router
from app.api.routes.voice import router as voice_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(users_router)
api_router.include_router(presence_router)
api_router.include_router(servers_router)
api_router.include_router(messages_router)
api_router.include_router(voice_router)
