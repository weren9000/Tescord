from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: str
    status: str
    environment: str
    database: str
    redis: str = 'disabled'
