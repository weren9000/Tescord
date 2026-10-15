from datetime import datetime, timezone
from uuid import UUID, uuid4
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, or_, func, update
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.db.inventory import InventoryItem, InventoryEvent, InventoryCatalog
from app.db.session import get_db
from app.services.inventory import asset_path, catalog_data, lock_inventory
from app.services.avatar_frames import frame_svg
from app.api.routes.users import _publish_profile_updates_for_user

router = APIRouter(prefix='/inventory', tags=['inventory'])


def admin(user: User = Depends(get_current_user)) -> User:
    if not (user.is_avatar_admin or user.is_admin):
        raise HTTPException(403, 'Требуется роль «Админ аватарок»')
    return user


def person(db, user_id):
    user = db.get(User, user_id) if user_id else None
    return {'id': str(user.id), 'nick': user.username, 'public_id': user.public_id,
            'avatar_updated_at': user.avatar_updated_at} if user else None


def item_data(db, item):
    return {'id': str(item.id), 'catalog_id': item.catalog_id, **catalog_data(db, item.catalog_id),
            'equipped': item.equipped, 'revoked': item.revoked, 'created_at': item.created_at,
            'owner': person(db, item.owner_id)}


@router.get('')
def inventory(page: int = Query(1, ge=1), kind: Literal['avatar', 'frame', 'wallpaper', 'theme'] | None = None,
              q: str = Query('', max_length=80), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(InventoryItem).join(InventoryCatalog, InventoryCatalog.id == InventoryItem.catalog_id).where(
        InventoryItem.owner_id == user.id, InventoryItem.revoked.is_(False))
    if kind: query = query.where(InventoryItem.kind == kind)
    if q.strip(): query = query.where(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'))
    result = paginate(db, query, page, InventoryItem.created_at.desc(), InventoryItem.id)
    events = db.scalars(select(InventoryEvent).where(InventoryEvent.recipient_id == user.id,
                           InventoryEvent.action.in_(['grant', 'gift', 'revoke']))
                           .order_by(InventoryEvent.created_at.desc()).limit(50)).all()
    unread = db.scalar(select(func.count()).select_from(InventoryEvent).where(
        InventoryEvent.recipient_id == user.id, InventoryEvent.read_at.is_(None),
        InventoryEvent.action.in_(['grant', 'gift', 'revoke'])))
    equipped = db.scalars(select(InventoryItem.id).where(InventoryItem.owner_id == user.id,
        InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False))).all()
    return {**result, 'items': [item_data(db, i) for i in result['items']], 'unread': unread,
            'equipped_ids': sorted(str(i) for i in equipped),
            'notifications': [{'id': str(e.id), 'action': e.action, 'created_at': e.created_at,
                               'name': catalog_data(db, db.get(InventoryItem, e.item_id).catalog_id)['name'],
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


def search_pattern(value):
    return '%' + value.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def paginate(db, query, page, *order):
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    pages = max(1, (total + 19) // 20)
    page = min(page, pages)
    return {'items': db.scalars(query.order_by(*order).offset((page-1)*20).limit(20)).all(),
            'total': total, 'page': page, 'pages': pages, 'page_size': 20}


def entry_data(entry):
    return {'id': entry.id, 'name': entry.name, 'kind': entry.kind, 'hidden': entry.hidden}


@router.get('/catalog')
def catalog(page: int = Query(1, ge=1), kind: Literal['avatar', 'frame', 'wallpaper', 'theme'] | None = None,
            q: str = Query('', max_length=80), user: User = Depends(admin), db: Session = Depends(get_db)):
    query = select(InventoryCatalog)
    if kind: query = query.where(InventoryCatalog.kind == kind)
    if q.strip(): query = query.where(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'))
    result = paginate(db, query, page, InventoryCatalog.created_at.desc(), InventoryCatalog.id)
    return {**result, 'items': [entry_data(i) for i in result['items']]}


class CatalogUpdate(BaseModel):
    name: str | None = None
    hidden: bool | None = None


@router.patch('/catalog/{catalog_id}')
def update_catalog(catalog_id: str, body: CatalogUpdate, user: User = Depends(admin), db: Session = Depends(get_db)):
    lock_inventory(db)
    entry = db.get(InventoryCatalog, catalog_id)
    if not entry: raise HTTPException(404, 'Предмет не найден')
    if body.name is not None:
        if not 1 <= len(body.name.strip()) <= 80: raise HTTPException(400, 'Название: от 1 до 80 символов')
        entry.name = body.name.strip()
    if body.hidden is not None: entry.hidden = body.hidden
    db.commit()
    return entry_data(entry)


@router.post('/catalog')
async def upload_catalog(name: str = Form(max_length=80), kind: Literal['avatar', 'frame', 'wallpaper'] = Form(),
                         image: UploadFile = File(), crop_x: float = Form(0.5, ge=0, le=1),
                         crop_y: float = Form(0.5, ge=0, le=1), zoom: float = Form(1, ge=1, le=3),
                         user: User = Depends(admin), db: Session = Depends(get_db)):
    from app.services.collectible_uploads import prepare_image
    from starlette.concurrency import run_in_threadpool
    if not name.strip(): raise HTTPException(400, 'Введите название')
    try:
        payload = await image.read(10*1024*1024+1)
    finally:
        await image.close()
    content = await run_in_threadpool(prepare_image, payload, kind, crop_x, crop_y, zoom)
    entry = InventoryCatalog(id=str(uuid4()), name=name.strip(), kind=kind, builtin=False, hidden=False, created_by=user.id)
    path = asset_path(entry.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(content)
        from app.services.image_previews import preview_path
        await run_in_threadpool(preview_path, path)
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return entry_data(entry)


@router.get('/assets/{catalog_id}')
def asset(catalog_id: str, request: Request, motion: bool = True, preview: bool = False, live: bool = False, db: Session = Depends(get_db)):
    if not db.get(InventoryCatalog, catalog_id): raise HTTPException(404, 'Предмет не найден')
    from app.services.living_wallpaper import CATALOG_ID, marsh_svg
    if catalog_id == CATALOG_ID and live and not preview:
        return Response(marsh_svg(motion=motion),media_type='image/svg+xml',headers={'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'})
    from app.services.themes import THEMES, theme_svg
    if catalog_id in THEMES:
        return Response(theme_svg(catalog_id), media_type='image/svg+xml', headers={'X-Content-Type-Options':'nosniff', 'Cache-Control':'public, max-age=3600'})
    if catalog_id == 'frame-neon':
        return Response(frame_svg(catalog_id, motion=motion and not preview), media_type='image/svg+xml',
                        headers={'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'})
    # Display is public; ownership is enforced when equipping, granting or gifting.
    path = asset_path(catalog_id)
    if not path.is_file(): raise HTTPException(404, 'Изображение не найдено')
    if preview:
        from app.services.image_previews import preview_response
        return preview_response(path, request)
    return FileResponse(path, media_type='image/png' if path.suffix == '.png' else 'image/webp')


@router.get('/issued')
def issued(owner_id: UUID | None = None, page: int = Query(1, ge=1),
           kind: Literal['avatar', 'frame', 'wallpaper', 'theme'] | None = None, q: str = Query('', max_length=80),
           user: User = Depends(admin), db: Session = Depends(get_db)):
    query = select(InventoryItem).join(InventoryCatalog, InventoryCatalog.id == InventoryItem.catalog_id).outerjoin(User, User.id == InventoryItem.owner_id)
    if owner_id: query = query.where(InventoryItem.owner_id == owner_id)
    if kind: query = query.where(InventoryItem.kind == kind)
    if q.strip(): query = query.where(or_(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'),
                                         User.username.ilike(search_pattern(q), escape='\\'), func.lower(User.email) == q.strip().lower()))
    result = paginate(db, query, page, InventoryItem.created_at.desc(), InventoryItem.id)
    return {**result, 'items': [item_data(db, i) for i in result['items']]}


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
    entry = db.get(InventoryCatalog, body.catalog_id)
    if not entry or entry.hidden: raise HTTPException(404, 'Предмет недоступен для выдачи')
    if not db.get(User, body.recipient_id): raise HTTPException(404, 'Получатель не найден')
    item = InventoryItem(catalog_id=body.catalog_id, kind=entry.kind, owner_id=body.recipient_id)
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
    if action == 'revoke' and not (user.is_avatar_admin or user.is_admin): raise HTTPException(403, 'Недостаточно прав')
    lock_inventory(db)
    if replay(db, body.request_id, user, action, item_id, body.recipient_id): return {'ok': True}
    item = db.get(InventoryItem, item_id)
    if not item or item.revoked: raise HTTPException(404, 'Предмет недоступен')
    if action != 'revoke' and item.owner_id != user.id: raise HTTPException(403, 'Предмет вам не принадлежит')
    owner = db.get(User, item.owner_id) if item.owner_id else None
    recipient_id = item.owner_id
    changed_profile = item.kind in ('avatar', 'frame') and (item.equipped or action == 'equip')
    if item.kind == 'wallpaper' and owner and (item.equipped or action == 'equip'):
        owner.chat_wallpaper = 'item' if action == 'equip' else None
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
    if item.kind == 'wallpaper' and action in ('gift', 'revoke'):
        from app.db.models import Server, ServerMember
        selection = 'item:' + str(item.id)
        db.execute(update(Server).where(Server.chat_wallpaper == selection).values(chat_wallpaper=None))
        db.execute(update(ServerMember).where(ServerMember.chat_wallpaper == selection).values(chat_wallpaper=None, wallpaper_override=False))
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


@router.get('/theme')
def active_theme(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.themes import THEMES
    item=db.scalar(select(InventoryItem).where(InventoryItem.owner_id==user.id,
        InventoryItem.kind=='theme',InventoryItem.equipped.is_(True),InventoryItem.revoked.is_(False)))
    if not item or item.catalog_id not in THEMES:
        return {'id':None,'item_id':None,'scheme':'dark','palette':{}}
    return {'id':item.catalog_id,'item_id':str(item.id),**THEMES[item.catalog_id]}


@router.post('/theme/reset')
def reset_theme(body: Action, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_inventory(db)
    item=db.scalar(select(InventoryItem).where(InventoryItem.owner_id==user.id,
        InventoryItem.kind=='theme',InventoryItem.equipped.is_(True),InventoryItem.revoked.is_(False)))
    if item: return change(item.id, 'unequip', body, user, db)
    return {'ok':True}
