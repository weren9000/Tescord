from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import User, UserApplication
from app.db.session import get_db

router = APIRouter(prefix='/applications', tags=['applications'])
CATALOG = {
    'game-calendar': {
        'name': 'Когда игра',
        'description': 'Календарь ролевых игр и конвентов.',
    },
}


class ApplicationResponse(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: StrictBool


@router.get('', response_model=list[ApplicationResponse])
def list_applications(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'private, no-store'
    connections = dict(db.execute(select(UserApplication.application_id, UserApplication.enabled)
                                  .where(UserApplication.user_id == user.id)).all())
    return [dict(id=key, **item, enabled=connections.get(key, False)) for key, item in CATALOG.items()]


@router.put('/{application_id}', response_model=ApplicationResponse)
def set_connection(application_id: str, body: ConnectionRequest, response: Response,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if application_id not in CATALOG:
        raise HTTPException(404, 'Приложение не найдено')
    statement = insert(UserApplication).values(user_id=user.id, application_id=application_id, enabled=body.enabled)
    db.execute(statement.on_conflict_do_update(
        index_elements=['user_id', 'application_id'], set_={'enabled': body.enabled}))
    db.commit()
    response.headers['Cache-Control'] = 'private, no-store'
    return dict(id=application_id, **CATALOG[application_id], enabled=body.enabled)
