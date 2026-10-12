from __future__ import annotations

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

settings = get_settings()
logger = logging.getLogger(__name__)


async def run_presence_sweeper() -> None:
    while True:
        await asyncio.sleep(10)
        expired_user_ids = site_presence_manager.collect_expired_user_ids()
        for user_id in expired_user_ids:
            await publish_presence_updated(user_id, is_online=False)


def initialize_database():
    ensure_development_seed_data()
    with SessionLocal() as db:
        db.execute(select(AuthSession.id).limit(0))
        db.execute(select(OutboxEvent.id).limit(0))
        ensure_workspace_defaults_for_all(db)
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(initialize_database)
    event_bus_task = await start_event_bus()
    presence_sweeper_task = asyncio.create_task(run_presence_sweeper())
    outbox_task = asyncio.create_task(run_message_outbox())
    media_task = asyncio.create_task(reconcile_media_permissions())
    try:
        yield
    finally:
        await stop_event_bus(event_bus_task)
        media_task.cancel()
        await asyncio.gather(media_task, return_exceptions=True)
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
