from __future__ import annotations
from app.services.pending_uploads import run_upload_cleanup

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.services.dev_seed import ensure_development_seed_data
from app.db.session import SessionLocal
from app.services.app_events import publish_presence_updated
from app.services.workspace_defaults import ensure_workspace_defaults_for_all
from app.services.site_presence import site_presence_manager
from app.services.message_outbox import run_message_outbox
from app.services.rate_limits import RateLimitMiddleware
from app.services.voice_sfu import reconcile_media_permissions
from sqlalchemy import select
from app.db.models import AuthSession, OutboxEvent
from app.api.dependencies.upload_admission import UploadAdmissionMiddleware
from app.services.event_bus import start_event_bus, stop_event_bus
from app.services.monitoring import collect_metrics
from app.services import cluster
from sqlalchemy import text
from redis.exceptions import RedisError
from starlette.responses import JSONResponse

from app.services.performance import PerformanceMiddleware, flush_metrics
from app.services.resource_events import ResourceEventsMiddleware

settings = get_settings()
logger = logging.getLogger(__name__)


async def run_presence_sweeper() -> None:
    while True:
        await asyncio.sleep(10)
        try:
            expired_user_ids = await asyncio.to_thread(site_presence_manager.collect_expired_user_ids)
            for user_id in expired_user_ids:
                await publish_presence_updated(user_id, is_online=False)
        except Exception:
            logger.warning('Presence sweep deferred')


def initialize_database():
    with SessionLocal() as db:
        db.execute(text('SELECT pg_advisory_xact_lock(743190038)'))
        ensure_development_seed_data()
        db.execute(select(AuthSession.id).limit(0))
        db.execute(select(OutboxEvent.id).limit(0))
        ensure_workspace_defaults_for_all(db)
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(initialize_database)
    event_bus_task = await start_event_bus()
    cluster_tasks = await cluster.start()
    performance_task = asyncio.create_task(flush_metrics())
    presence_sweeper_task = asyncio.create_task(run_presence_sweeper())
    outbox_task = asyncio.create_task(run_message_outbox())
    upload_cleanup_task = asyncio.create_task(run_upload_cleanup())
    media_task = asyncio.create_task(cluster.singleton('media', reconcile_media_permissions))
    monitoring_task = asyncio.create_task(cluster.singleton('monitoring', collect_metrics))
    try:
        yield
    finally:
        performance_task.cancel()
        await asyncio.gather(performance_task, return_exceptions=True)
        monitoring_task.cancel()
        await asyncio.gather(monitoring_task, return_exceptions=True)
        await cluster.stop(cluster_tasks)
        await stop_event_bus(event_bus_task)
        media_task.cancel()
        await asyncio.gather(media_task, return_exceptions=True)
        upload_cleanup_task.cancel()
        await asyncio.gather(upload_cleanup_task, return_exceptions=True)
        outbox_task.cancel()
        await asyncio.gather(outbox_task, return_exceptions=True)
        presence_sweeper_task.cancel()
        try:
            await presence_sweeper_task
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(RedisError)
async def redis_unavailable(request, exc):
    if request.scope['type'] == 'websocket':
        try:
            await request.close(code=1013, reason='Service temporarily unavailable')
        except RuntimeError:
            pass
        return
    return JSONResponse({'detail': 'Service temporarily unavailable; retry shortly'},
                        status_code=503, headers={'Retry-After': '5'})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_hosts,
)

app.include_router(api_router, prefix=settings.api_prefix)
app.add_middleware(UploadAdmissionMiddleware)
app.add_middleware(RateLimitMiddleware)


@app.get("/", include_in_schema=False)
def read_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "health": f"{settings.api_prefix}/health",
        "docs": "/docs",
    }

app.add_middleware(ResourceEventsMiddleware)
app.add_middleware(PerformanceMiddleware)
