from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.services.dev_seed import ensure_development_seed_data
from app.db.session import SessionLocal
from app.services.default_tavern import ensure_default_tavern_workspace_setup

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
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
    yield

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
