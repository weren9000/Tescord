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
from app.services.default_tavern import ensure_default_tavern_workspace_setup
from app.services.site_presence import site_presence_manager

settings = get_settings()
logger = logging.getLogger(__name__)


async def run_presence_sweeper() -> None:
    while True:
        await asyncio.sleep(10)
        expired_user_ids = site_presence_manager.collect_expired_user_ids()
        for user_id in expired_user_ids:
            await publish_presence_updated(user_id, is_online=False)


@asynccontextmanager
async def lifespan(_: FastAPI):
    presence_sweeper_task = asyncio.create_task(run_presence_sweeper())
    try:
        ensure_development_seed_data()
    except Exception:  # pragma: no cover - startup resilience matters more than failing hard here
        logger.exception("Could not seed development data")
    try:
        with SessionLocal() as db:
            ensure_default_tavern_workspace_setup(db)
            db.commit()
    except Exception:  # pragma: no cover - startup resilience matters more than failing hard here
        logger.exception("Could not ensure default tavern voice channels")
    try:
        yield
    finally:
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


@app.get("/", include_in_schema=False)
def read_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "health": f"{settings.api_prefix}/health",
        "docs": "/docs",
    }
