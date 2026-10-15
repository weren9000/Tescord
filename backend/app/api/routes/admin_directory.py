"""Read-only system administration. Never expose direct conversations or messages."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.db.models import Channel, Server, ServerKind, ServerMember, User
from app.db.session import get_db
from app.services.server_icons import ALLOWED_SERVER_ICON_ASSETS


def require_admin(response: Response, user: User = Depends(get_current_user)):
    if not user.is_admin:
        raise HTTPException(403, 'Требуются права администратора системы')
    response.headers['Cache-Control'] = 'no-store'
    return user


router = APIRouter(prefix='/admin/directory', tags=['admin'], dependencies=[Depends(require_admin)])
Kind = Literal['groups', 'platforms']
KINDS = {'groups': ServerKind.GROUP_CHAT, 'platforms': ServerKind.WORKSPACE}
USER_FIELDS = (User.id, User.public_id, User.username.label('name'), User.is_admin,
               User.is_avatar_admin, User.avatar_updated_at, User.created_at)
SPACE_FIELDS = (Server.id, Server.name, Server.kind, Server.owner_id, Server.icon_asset,
                Server.icon_updated_at, Server.created_at, User.username.label('owner_name'))
member_count = select(func.count(ServerMember.id)).where(ServerMember.server_id == Server.id).correlate(Server).scalar_subquery()
channel_count = select(func.count(Channel.id)).where(Channel.server_id == Server.id).correlate(Server).scalar_subquery()


def pattern(q):
    return '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def paged(db, query, page, size):
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    pages = max(1, (total + size - 1) // size)
    page = min(page, pages)
    return dict(items=[serialize(row) for row in db.execute(query.offset((page-1)*size).limit(size)).mappings()],
                total=total, page=page, pages=pages)


def serialize(row):
    item = dict(row)
    asset = item.get('icon_asset')
    if asset in ALLOWED_SERVER_ICON_ASSETS:
        item['icon_url'] = f'/assets/group-icons/icon-{ALLOWED_SERVER_ICON_ASSETS.index(asset)+1:02}.png'
    return item


def space_query():
    return select(*SPACE_FIELDS, member_count.label('members_count'), channel_count.label('channels_count')).join(User, User.id == Server.owner_id)


def space_or_404(db, kind, key):
    row = db.execute(space_query().where(Server.id == key, Server.kind == KINDS[kind])).mappings().first()
    if not row:
        raise HTTPException(404, 'Запись не найдена')
    return dict(row)


@router.get('/counts')
def counts(db: Session = Depends(get_db)):
    return {'users': db.scalar(select(func.count(User.id))), **{
        key: db.scalar(select(func.count(Server.id)).where(Server.kind == value)) for key, value in KINDS.items()}}


@router.get('/users')
def users(q: str = Query('', max_length=320), role: Literal['all', 'admin', 'avatar', 'regular'] = 'all',
          sort: Literal['new', 'old', 'name'] = 'new', page: int = Query(1, ge=1),
          size: int = Query(24, ge=1, le=48), db: Session = Depends(get_db)):
    query = select(*USER_FIELDS)
    if q.strip():
        query = query.where(or_(User.username.ilike(pattern(q), escape='\\'), User.email.ilike(pattern(q), escape='\\'), cast(User.public_id, String) == q.strip(), cast(User.id, String) == q.strip()))
    if role == 'admin': query = query.where(User.is_admin.is_(True))
    if role == 'avatar': query = query.where(User.is_avatar_admin.is_(True))
    if role == 'regular': query = query.where(User.is_admin.is_(False), User.is_avatar_admin.is_(False))
    order = {'new': User.created_at.desc(), 'old': User.created_at.asc(), 'name': func.lower(User.username)}[sort]
    return paged(db, query.order_by(order, User.id), page, size)


@router.get('/users/{key}')
def user_detail(key: UUID, db: Session = Depends(get_db)):
    row = db.execute(select(*USER_FIELDS, User.email).where(User.id == key)).mappings().first()
    if not row: raise HTTPException(404, 'Пользователь не найден')
    return dict(row)


@router.get('/users/{key}/spaces')
def user_spaces(key: UUID, page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    user_detail(key, db)
    query = space_query().join(ServerMember, ServerMember.server_id == Server.id).where(
        ServerMember.user_id == key, Server.kind.in_(list(KINDS.values())))
    return paged(db, query.order_by(Server.name, Server.id), page, 24)


@router.get('/spaces/{kind}')
def spaces(kind: Kind, q: str = Query('', max_length=80), owner: str = Query('', max_length=80),
           sort: Literal['new', 'old', 'name', 'members'] = 'new', page: int = Query(1, ge=1),
           size: int = Query(24, ge=1, le=48), db: Session = Depends(get_db)):
    query = space_query().where(Server.kind == KINDS[kind])
    if q.strip(): query = query.where(or_(Server.name.ilike(pattern(q), escape='\\'), cast(Server.id, String) == q.strip()))
    if owner.strip(): query = query.where(or_(User.username.ilike(pattern(owner), escape='\\'), cast(User.public_id, String) == owner.strip(), cast(User.id, String) == owner.strip()))
    order = {'new': Server.created_at.desc(), 'old': Server.created_at.asc(), 'name': func.lower(Server.name), 'members': member_count.desc()}[sort]
    return paged(db, query.order_by(order, Server.id), page, size)


@router.get('/spaces/{kind}/{key}')
def space_detail(kind: Kind, key: UUID, db: Session = Depends(get_db)):
    row = space_or_404(db, kind, key)
    row['description'] = db.scalar(select(Server.description).where(Server.id == key))
    return row


@router.get('/spaces/{kind}/{key}/members')
def members(kind: Kind, key: UUID, q: str = Query('', max_length=80), page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    space_or_404(db, kind, key)
    query = select(*USER_FIELDS, ServerMember.role).join(ServerMember, ServerMember.user_id == User.id).where(ServerMember.server_id == key)
    if q.strip(): query = query.where(or_(User.username.ilike(pattern(q), escape='\\'), cast(User.public_id, String) == q.strip()))
    return paged(db, query.order_by(User.username, User.id), page, 24)


@router.get('/spaces/{kind}/{key}/channels')
def channels(kind: Kind, key: UUID, page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    space_or_404(db, kind, key)
    return paged(db, select(Channel.id, Channel.name, Channel.type).where(Channel.server_id == key).order_by(Channel.position, Channel.id), page, 24)
