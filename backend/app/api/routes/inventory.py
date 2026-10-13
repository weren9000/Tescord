from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, or_, func, update
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.db.inventory import InventoryItem, InventoryEvent
from app.db.session import get_db
from app.services.inventory import CATALOG, ASSETS, lock_inventory
from app.api.routes.users import _publish_profile_updates_for_user

router = APIRouter(prefix='/inventory', tags=['inventory'])


def admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_avatar_admin:
        raise HTTPException(403, 'Требуется роль «Админ аватарок»')
    return user


def person(db, user_id):
    user = db.get(User, user_id) if user_id else None
    return {'id': str(user.id), 'nick': user.username, 'public_id': user.public_id,
            'avatar_updated_at': user.avatar_updated_at} if user else None


def item_data(db, item):
    return {'id': str(item.id), 'catalog_id': item.catalog_id, **CATALOG[item.catalog_id],
            'equipped': item.equipped, 'revoked': item.revoked, 'created_at': item.created_at,
            'owner': person(db, item.owner_id)}


@router.get('')
def inventory(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(InventoryItem).where(InventoryItem.owner_id == user.id,
                          InventoryItem.revoked.is_(False)).order_by(InventoryItem.created_at.desc())).all()
    events = db.scalars(select(InventoryEvent).where(InventoryEvent.recipient_id == user.id,
                           InventoryEvent.action.in_(['grant', 'gift', 'revoke']))
                           .order_by(InventoryEvent.created_at.desc()).limit(50)).all()
    unread = db.scalar(select(func.count()).select_from(InventoryEvent).where(
        InventoryEvent.recipient_id == user.id, InventoryEvent.read_at.is_(None),
        InventoryEvent.action.in_(['grant', 'gift', 'revoke'])))
    return {'items': [item_data(db, i) for i in items], 'unread': unread,
            'notifications': [{'id': str(e.id), 'action': e.action, 'created_at': e.created_at,
                               'name': CATALOG[db.get(InventoryItem, e.item_id).catalog_id]['name'],
                               'actor': person(db, e.actor_id), 'unread': e.read_at is None} for e in events]}


@router.post('/read')
def read_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(update(InventoryEvent).where(InventoryEvent.recipient_id == user.id,
               InventoryEvent.read_at.is_(None)).values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {'ok': True}


@router.get('/users')
def users(q: str = Query(min_length=2, max_length=320), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = q.strip()
    if len(query) < 2: return []
    match = func.lower(User.email) == query.lower() if '@' in query else User.username.ilike('%'+query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%', escape='\\')
    return [person(db, u.id) for u in db.scalars(select(User).where(match).order_by(User.username).limit(20))]


@router.get('/catalog')
def catalog(user: User = Depends(admin)):
    return [{'id': k, **v} for k, v in CATALOG.items()]


@router.get('/assets/{catalog_id}')
def asset(catalog_id: str):
    if catalog_id not in CATALOG: raise HTTPException(404, 'Предмет не найден')
    # Display is public; ownership is enforced when equipping, granting or gifting.
    return FileResponse(ASSETS / (catalog_id+'.webp'), media_type='image/webp')


@router.get('/issued')
def issued(owner_id: UUID | None = None, offset: int = Query(0, ge=0), user: User = Depends(admin), db: Session = Depends(get_db)):
    query = select(InventoryItem)
    if owner_id: query = query.where(InventoryItem.owner_id == owner_id)
    return [item_data(db, i) for i in db.scalars(query.order_by(InventoryItem.created_at.desc()).offset(offset).limit(50))]


class Grant(BaseModel):
    catalog_id: str
    recipient_id: UUID
    request_id: UUID


def replay(db, request_id, actor, action, item_id=None, recipient=None):
    event = db.scalar(select(InventoryEvent).where(InventoryEvent.request_id == request_id))
    if event:
        if event.actor_id != actor.id or event.action != action or (item_id and event.item_id != item_id) or (recipient and event.recipient_id != recipient):
            raise HTTPException(409, 'Ключ операции уже использован')
        return event


@router.post('/grant')
def grant(body: Grant, user: User = Depends(admin), db: Session = Depends(get_db)):
    lock_inventory(db)
    previous = replay(db, body.request_id, user, 'grant', recipient=body.recipient_id)
    if previous:
        item = db.get(InventoryItem, previous.item_id)
        if item.catalog_id != body.catalog_id: raise HTTPException(409, 'Ключ операции уже использован')
        return {'ok': True, 'item_id': str(item.id)}
    if body.catalog_id not in CATALOG: raise HTTPException(404, 'Предмет не найден')
    if not db.get(User, body.recipient_id): raise HTTPException(404, 'Получатель не найден')
    item = InventoryItem(catalog_id=body.catalog_id, kind=CATALOG[body.catalog_id]['kind'], owner_id=body.recipient_id)
    db.add(item); db.flush()
    db.add(InventoryEvent(request_id=body.request_id, item_id=item.id, actor_id=user.id,
                          recipient_id=body.recipient_id, action='grant'))
    db.commit()
    return {'ok': True, 'item_id': str(item.id)}


class Action(BaseModel):
    request_id: UUID
    recipient_id: UUID | None = None


@router.post('/items/{item_id}/{action}')
def change(item_id: UUID, action: str, body: Action, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if action not in ('equip', 'unequip', 'gift', 'revoke'): raise HTTPException(404, 'Действие не найдено')
    if action == 'revoke' and not user.is_avatar_admin: raise HTTPException(403, 'Недостаточно прав')
    lock_inventory(db)
    if replay(db, body.request_id, user, action, item_id, body.recipient_id): return {'ok': True}
    item = db.get(InventoryItem, item_id)
    if not item or item.revoked: raise HTTPException(404, 'Предмет недоступен')
    if action != 'revoke' and item.owner_id != user.id: raise HTTPException(403, 'Предмет вам не принадлежит')
    owner = db.get(User, item.owner_id) if item.owner_id else None
    recipient_id = item.owner_id
    changed_profile = item.equipped or action == 'equip'
    if action == 'gift':
        if not body.recipient_id or body.recipient_id == user.id: raise HTTPException(400, 'Выберите другого получателя')
        if not db.get(User, body.recipient_id): raise HTTPException(404, 'Получатель не найден')
        item.owner_id = body.recipient_id
        item.equipped = False
        recipient_id = body.recipient_id
    elif action == 'revoke':
        # Require the owner seen in the confirmation: do not revoke from a new owner silently.
        if body.recipient_id != item.owner_id: raise HTTPException(409, 'Владелец изменился. Обновите список')
        item.revoked = True
        item.equipped = False
    elif action == 'equip':
        db.execute(update(InventoryItem).where(InventoryItem.owner_id == user.id,
                   InventoryItem.kind == item.kind).values(equipped=False))
        db.flush()
        item.equipped = True
        if item.kind == 'avatar':
            owner.avatar_content = None
            owner.avatar_filename = None
            owner.avatar_mime_type = None
            owner.avatar_size_bytes = None
    else:
        item.equipped = False
    if changed_profile and owner: owner.avatar_updated_at = datetime.now(timezone.utc)
    db.add(InventoryEvent(request_id=body.request_id, item_id=item.id, actor_id=user.id,
                          recipient_id=recipient_id, action=action))
    db.commit()
    if changed_profile and owner: _publish_profile_updates_for_user(db, owner.id)
    return {'ok': True}


@router.get('/items/{item_id}/history')
def history(item_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.get(InventoryItem, item_id)
    if not item or (not user.is_avatar_admin and item.owner_id != user.id): raise HTTPException(404, 'Предмет недоступен')
    events = db.scalars(select(InventoryEvent).where(InventoryEvent.item_id == item_id).order_by(InventoryEvent.created_at.desc()).limit(100))
    return [{'action': e.action, 'actor': person(db, e.actor_id), 'recipient': person(db, e.recipient_id), 'created_at': e.created_at} for e in events]
