from pathlib import Path
from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.db.models import User, Server, ServerMember, ServerKind
from app.db.inventory import InventoryItem, InventoryCatalog
from app.db.session import get_db
from app.services.inventory import lock_inventory
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
    selected = user.chat_wallpaper if user.chat_wallpaper != 'personal' else None
    if selected == 'item':
        item = db.scalar(select(InventoryItem).where(InventoryItem.owner_id == user.id,
            InventoryItem.kind == 'wallpaper', InventoryItem.equipped.is_(True), InventoryItem.revoked.is_(False)))
        selected = 'item:' + str(item.id) if item else None
    return {'selected': selected, 'scale': user.wallpaper_scale, 'dim': user.wallpaper_dim,
            'personal': None}


def resolve_selection(selected, scale, dim, owner_id, db):
    asset = None
    valid = True
    if selected in PRESETS:
        asset = '/api/wallpapers/presets/' + selected
    elif selected is not None:
        valid = False
        if selected.startswith('item:'):
            try:
                item = db.get(InventoryItem, UUID(selected[5:]))
            except ValueError:
                item = None
            if item and item.owner_id == owner_id and item.kind == 'wallpaper' and not item.revoked:
                asset = '/api/inventory/assets/' + item.catalog_id
                valid = True
    return valid, {'selected': selected if valid else None, 'scale': scale, 'dim': dim, 'asset': asset}


def validate_selection(selected, user, db):
    valid, _ = resolve_selection(selected, 100, 35, user.id, db)
    if not valid:
        raise HTTPException(403 if selected and selected.startswith('item:') else 400, 'Выберите базовые обои или предмет из своего инвентаря')


def chat_membership(server_id, user, db):
    membership = db.scalar(select(ServerMember).where(ServerMember.server_id == server_id, ServerMember.user_id == user.id))
    if membership is None:
        raise HTTPException(404, 'Беседа не найдена')
    return membership, db.get(Server, server_id)


def chat_state(server_id, user, db):
    member, server = chat_membership(server_id, user, db)
    direct = server.kind == ServerKind.DIRECT
    if direct:
        peer = db.scalar(select(User).join(ServerMember, ServerMember.user_id == User.id).where(
            ServerMember.server_id == server.id, User.id != user.id))
        choice = state(peer, db) if peer else {'selected': None, 'scale': 100, 'dim': 35}
        _, shared = resolve_selection(choice['selected'], choice['scale'], choice['dim'], peer.id if peer else None, db)
    else:
        _, shared = resolve_selection(server.chat_wallpaper, server.wallpaper_scale, server.wallpaper_dim, server.owner_id, db)
    valid, personal = resolve_selection(member.chat_wallpaper, member.wallpaper_scale, member.wallpaper_dim, user.id, db)
    overridden = member.wallpaper_override and valid
    return {'shared': shared, 'override': personal if overridden else None,
            'effective': personal if overridden else shared, 'source': 'personal' if overridden else 'peer' if direct else 'owner',
            'can_manage': not direct and server.owner_id == user.id, 'kind': server.kind.value,
            'name': peer.username if direct and peer else server.name}


@router.get('')
def get_wallpapers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.execute(select(InventoryItem, InventoryCatalog).join(InventoryCatalog,
        InventoryCatalog.id == InventoryItem.catalog_id).where(InventoryItem.owner_id == user.id,
        InventoryItem.kind == 'wallpaper', InventoryItem.revoked.is_(False)).order_by(InventoryItem.created_at.desc())).all()
    return {**state(user, db), 'presets': [{'id': key, 'name': name} for key,name in PRESETS.items()],
            'items': [{'id': 'item:'+str(item.id), 'name': entry.name,
                       'asset': '/api/inventory/assets/'+entry.id} for item,entry in items]}


@router.get('/chats/{server_id}')
def get_chat_wallpapers(server_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    context = chat_state(server_id, user, db)
    return {**get_wallpapers(user, db), 'context': context}


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
    await image.close()
    raise HTTPException(403, 'Используйте базовые обои или предметы из инвентаря')


class Selection(BaseModel):
    selected: str | None = Field(None, max_length=64)
    scale: int = Field(100, ge=50, le=200)
    dim: int = Field(35, ge=0, le=85)


class ChatSelection(Selection):
    target: Literal['personal', 'shared'] = 'personal'
    inherit: bool = False


@router.put('/chats/{server_id}')
def choose_chat(server_id: UUID, body: ChatSelection, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_inventory(db)
    member, server = chat_membership(server_id, user, db)
    if body.target == 'shared':
        if server.kind == ServerKind.DIRECT or server.owner_id != user.id:
            raise HTTPException(403, 'Общие обои может менять только владелец группы или площадки')
        target = server
    else:
        target = member
        member.wallpaper_override = not body.inherit
    selected = None if body.inherit else body.selected
    validate_selection(selected, user, db)
    target.chat_wallpaper = selected
    target.wallpaper_scale, target.wallpaper_dim = body.scale, body.dim
    db.commit()
    return chat_state(server_id, user, db)


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
        raise HTTPException(403, 'Используйте базовые обои или предметы из инвентаря')
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
