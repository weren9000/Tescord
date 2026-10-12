from __future__ import annotations

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine
from app.schemas.health import HealthResponse

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
def read_health(response: Response) -> HealthResponse:
    settings = get_settings()
    database_status = "offline"
    app_status = "ok"

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_status = "online"
    except Exception:
        app_status = "degraded"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return HealthResponse(
        service=settings.app_name,
        status=app_status,
        environment=settings.environment,
        database=database_status,
    )
