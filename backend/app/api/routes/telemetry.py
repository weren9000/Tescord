from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.services.performance import observe
from app.services.cluster import client, PREFIX
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix='/telemetry', tags=['telemetry'])


class CallSample(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    rtt_ms: float | None = Field(default=None, ge=0, le=60000)
    jitter_ms: float | None = Field(default=None, ge=0, le=60000)
    loss_percent: float | None = Field(default=None, ge=0, le=100)
    connect_ms: float | None = Field(default=None, ge=0, le=300000)
    reconnects: int = Field(default=0, ge=0, le=100)


@router.post('/calls', status_code=204)
async def call_sample(sample: CallSample, user: User = Depends(get_current_user)):
    try:
        accepted = await run_in_threadpool(client().set, PREFIX + 'telemetry-rate:' + str(user.id), '1', nx=True, ex=10)
    except Exception:
        return Response(status_code=204)
    if accepted:
        for name, value in sample.model_dump().items():
            if value is not None:
                observe('call_' + name, value)
    return Response(status_code=204)
