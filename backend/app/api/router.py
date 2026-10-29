from app.api.routes.shop import router as shop_router
from app.api.routes.applications import router as applications_router
from fastapi import APIRouter
from app.api.routes.wallets import router as wallets_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.admin_directory import router as admin_directory_router
from app.api.routes.inventory_batches import router as inventory_batches_router
from app.api.routes.inventory import router as inventory_router

from app.api.routes.attention import router as attention_router
from app.api.routes.auth import router as auth_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.direct_calls import router as direct_calls_router
from app.api.routes.events import router as events_router
from app.api.routes.friend_links import router as friend_links_router
from app.api.routes.friends import router as friends_router
from app.api.routes.health import router as health_router
from app.api.routes.invites import router as invites_router
from app.api.routes.friend_space_invites import router as friend_space_invites_router
from app.api.routes.messages import router as messages_router
from app.api.routes.presence import router as presence_router
from app.api.routes.push import router as push_router
from app.api.routes.search import router as search_router
from app.api.routes.servers import router as servers_router
from app.api.routes.users import router as users_router
from app.api.routes.voice import router as voice_router

from app.api.routes.wallpapers import router as wallpapers_router

api_router = APIRouter()
api_router.include_router(applications_router)
from app.api.routes.rooms import router as rooms_router
api_router.include_router(rooms_router)
from app.api.routes.platforms import router as platforms_router
api_router.include_router(platforms_router)
api_router.include_router(wallets_router)
api_router.include_router(analytics_router)
api_router.include_router(admin_directory_router)
api_router.include_router(inventory_batches_router)
api_router.include_router(wallpapers_router)
api_router.include_router(inventory_router)
api_router.include_router(invites_router)
api_router.include_router(friend_space_invites_router)
api_router.include_router(attention_router)
api_router.include_router(auth_router)
api_router.include_router(conversations_router)
api_router.include_router(direct_calls_router)
api_router.include_router(events_router)
api_router.include_router(friend_links_router)
api_router.include_router(friends_router)
api_router.include_router(health_router)
api_router.include_router(users_router)
api_router.include_router(presence_router)
api_router.include_router(push_router)
api_router.include_router(search_router)
api_router.include_router(servers_router)
api_router.include_router(messages_router)
api_router.include_router(voice_router)

api_router.include_router(shop_router)

from app.api.routes.telemetry import router as telemetry_router
api_router.include_router(telemetry_router)
