from pathlib import Path
from uuid import uuid4, UUID
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from app.api.dependencies.auth import get_current_user
from app.db.models import User
from app.db.inventory import InventoryItem, InventoryCatalog
from app.db.session import get_db
from app.services.inventory import lock_inventory
from app.services.collectible_uploads import prepare_image
from app.services.attachment_storage import _uploads_root

router = APIRouter(prefix='/wallpapers', tags=['wallpapers'])
PRESETS = dict(zip(
    ['space','games','fairytale','magic','cyberpunk','forest','fantasy','gothic','vikings','pirates'],
    ['Космос','Игры','Сказка','Магия','Киберпанк','Лес','Фэнтези','Готика','Викинги','Пираты']))
ASSETS = Path(__file__).resolve().parents[2] / 'assets' / 'wallpapers'


def personal_path(key):
    UUID(key)
    return _uploads_root() / 'wallpapers' / (key + '.webp')


def state(user, db):
    selected = user.chat_wallpaper
    if selected == 'item':
        item = db.scalar(select(InventoryItem).where(InventoryItem.owner_id == user.id,
            InventoryItem.kind == 'wallpaper', InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False)))
        selected = 'item:' + str(item.id) if item else None
    return {'selected': selected, 'scale': user.wallpaper_scale, 'dim': user.wallpaper_dim,
            'personal': user.personal_wallpaper}


@router.get('')
def get_wallpapers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.execute(select(InventoryItem, InventoryCatalog).join(InventoryCatalog,
        InventoryCatalog.id == InventoryItem.catalog_id).where(InventoryItem.owner_id == user.id,
        InventoryItem.kind == 'wallpaper', InventoryItem.revoked.is_(False)).order_by(InventoryItem.created_at.desc())).all()
    return {**state(user, db), 'presets': [{'id': key, 'name': name} for key,name in PRESETS.items()],
            'items': [{'id': 'item:'+str(item.id), 'name': entry.name,
                       'asset': '/api/inventory/assets/'+entry.id} for item,entry in items]}


@router.get('/presets/{key}')
def preset(key: str):
    if key not in PRESETS: raise HTTPException(404, 'Обои не найдены')
    return FileResponse(ASSETS / (key+'.webp'), media_type='image/webp')


@router.get('/personal/{key}')
def personal(key: str, user: User = Depends(get_current_user)):
    if key != user.personal_wallpaper: raise HTTPException(404, 'Обои не найдены')
    return FileResponse(personal_path(key), media_type='image/webp', headers={'Cache-Control':'private, no-store'})


@router.post('/personal')
async def upload(image: UploadFile = File(), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try: payload = await image.read(10*1024*1024+1)
    finally: await image.close()
    content = await run_in_threadpool(prepare_image, payload, 'wallpaper', 0.5, 0.5, 1)
    lock_inventory(db)
    db.refresh(user)
    previous = user.personal_wallpaper
    key = str(uuid4())
    path = personal_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(content)
        user.personal_wallpaper = key
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    if previous: personal_path(previous).unlink(missing_ok=True)
    return {'personal': key}


class Selection(BaseModel):
    selected: str | None = Field(None, max_length=64)
    scale: int = Field(100, ge=50, le=200)
    dim: int = Field(35, ge=0, le=85)


@router.put('')
def choose(body: Selection, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_inventory(db)
    db.refresh(user)
    selected = body.selected
    item = None
    if selected and selected.startswith('item:'):
        try: item_id = UUID(selected[5:])
        except ValueError: raise HTTPException(400, 'Обои не найдены')
        item = db.get(InventoryItem, item_id)
        if not item or item.owner_id != user.id or item.kind != 'wallpaper' or item.revoked:
            raise HTTPException(403, 'Обои вам не принадлежат')
    elif selected == 'personal':
        if not user.personal_wallpaper: raise HTTPException(400, 'Сначала загрузите изображение')
    elif selected is not None and selected not in PRESETS:
        raise HTTPException(400, 'Обои не найдены')
    db.execute(update(InventoryItem).where(InventoryItem.owner_id == user.id,
        InventoryItem.kind == 'wallpaper').values(equipped=False))
    db.flush()
    if item: item.equipped = True
    user.chat_wallpaper = 'item' if item else selected
    user.wallpaper_scale, user.wallpaper_dim = body.scale, body.dim
    db.commit()
    return state(user, db)
