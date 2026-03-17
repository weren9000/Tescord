from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.services.site_presence import site_presence_manager

router = APIRouter(prefix="/presence", tags=["presence"])


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
def create_presence_heartbeat(current_user: User = Depends(get_current_user)) -> Response:
    site_presence_manager.mark_active(current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
