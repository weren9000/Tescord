from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.core.config import get_settings
from app.db.models import User, UserApplication
from app.db.session import get_db
from app.services.islands_grants import create_islands_grant

router = APIRouter(prefix='/applications', tags=['applications'])
CATALOG = {
    'game-calendar': {
        'name': 'Когда игра',
        'description': 'Календарь ролевых игр и конвентов.',
    },
}


def application_catalog():
    catalog = dict(CATALOG)
    settings = get_settings()
    if settings.islands_enabled and settings.islands_grant_private_key_path:
        catalog['islands'] = {
            'name': 'Острова',
            'description': 'Настольная стратегия для 3–4 друзей: стройте, торгуйте и исследуйте остров.',
        }
    return catalog


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
    return [dict(id=key, **item, enabled=connections.get(key, False)) for key, item in application_catalog().items()]


@router.put('/{application_id}', response_model=ApplicationResponse)
def set_connection(application_id: str, body: ConnectionRequest, response: Response,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    catalog = application_catalog()
    if application_id not in catalog:
        raise HTTPException(404, 'Приложение не найдено')
    statement = insert(UserApplication).values(user_id=user.id, application_id=application_id, enabled=body.enabled)
    db.execute(statement.on_conflict_do_update(
        index_elements=['user_id', 'application_id'], set_={'enabled': body.enabled}))
    db.commit()
    response.headers['Cache-Control'] = 'private, no-store'
    return dict(id=application_id, **catalog[application_id], enabled=body.enabled)


@router.post('/islands/grant')
def islands_grant(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    if 'islands' not in application_catalog():
        raise HTTPException(404, 'Приложение недоступно')
    enabled = db.scalar(select(UserApplication.enabled).where(
        UserApplication.user_id == user.id, UserApplication.application_id == 'islands'))
    if not enabled:
        raise HTTPException(403, 'Подключите Острова в каталоге приложений')
    try:
        grant = create_islands_grant(str(user.id), user.username, settings.islands_grant_private_key_path)
    except (OSError, ValueError, TypeError):
        raise HTTPException(503, 'Вход в игру временно недоступен') from None
    response.headers['Cache-Control'] = 'private, no-store'
    return grant
