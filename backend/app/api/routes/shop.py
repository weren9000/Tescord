from typing import Literal
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text, or_
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.api.routes.admin_directory import require_admin
from app.api.routes.inventory import search_pattern, paginate, usage_expression
from app.db.models import User, WalletOperation
from app.db.inventory import InventoryCatalog, InventoryItem, InventoryEvent
from app.db.shop import ShopOffer, ShopPurchase, ShopAudit
from app.db.session import get_db
from app.services.inventory import lock_inventory

router = APIRouter(prefix='/shop', tags=['shop'])
Kind = Literal['avatar', 'frame', 'wallpaper', 'theme']


def manager(response: Response, user: User = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    if not (user.is_admin or user.is_shop_admin):
        raise HTTPException(403, 'Требуется право «Управление магазином»')
    return user


def offer_data(offer):
    return {key: getattr(offer, key) for key in ('price', 'status', 'position', 'recommended', 'version')} if offer else {}


def receipt(row):
    return dict(id=row.id, user_id=row.user_id, buyer_name=row.buyer_name, catalog_id=row.catalog_id,
                item_id=row.item_id, name=row.name, price=row.price, balance_after=row.balance_after, created_at=row.created_at)


@router.get('')
def offers(response: Response, kind: Kind | None = None, q: str = Query('', max_length=80),
           sort: Literal['new', 'cheap', 'expensive'] = 'new', unowned: bool = False,
           min_price: int | None = Query(None, ge=0), max_price: int | None = Query(None, ge=0),
           recommended: bool = False,
           page: int = Query(1, ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    owned = select(func.count(InventoryItem.id)).where(InventoryItem.owner_id == user.id,
        InventoryItem.revoked.is_(False), InventoryItem.catalog_id == InventoryCatalog.id).correlate(InventoryCatalog).scalar_subquery()
    query = select(InventoryCatalog).join(ShopOffer).where(ShopOffer.status == 'published', InventoryCatalog.hidden.is_(False))
    if q.strip(): query = query.where(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'))
    if unowned: query = query.where(owned == 0)
    if min_price is not None: query = query.where(ShopOffer.price >= min_price)
    if max_price is not None: query = query.where(ShopOffer.price <= max_price)
    if recommended: query = query.where(ShopOffer.recommended.is_(True))
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(422, 'Минимальная цена больше максимальной')
    counts = dict(db.execute(query.with_only_columns(InventoryCatalog.kind, func.count()).group_by(InventoryCatalog.kind)).all())
    if kind: query = query.where(InventoryCatalog.kind == kind)
    order = {'new': InventoryCatalog.created_at.desc(), 'cheap': ShopOffer.price, 'expensive': ShopOffer.price.desc()}[sort]
    result = paginate(db, query, page, *([ShopOffer.recommended.desc(), ShopOffer.position] if sort == 'new' else []), order, InventoryCatalog.id)
    ids = [e.id for e in result['items']]
    prices = {e.catalog_id: e for e in db.scalars(select(ShopOffer).where(ShopOffer.catalog_id.in_(ids)))} if ids else {}
    quantities = dict(db.execute(select(InventoryItem.catalog_id, func.count()).where(
        InventoryItem.owner_id == user.id, InventoryItem.revoked.is_(False),
        InventoryItem.catalog_id.in_(ids)).group_by(InventoryItem.catalog_id)).all()) if ids else {}
    result['items'] = [dict(id=e.id, name=e.name, kind=e.kind, **offer_data(prices[e.id]),
                           owned=quantities.get(e.id, 0)) for e in result['items']]
    result['categories'] = counts
    return result


def period(query, column, start: date | None, end: date | None):
    if start and end and start > end:
        raise HTTPException(422, 'Начало периода позже окончания')
    if start: query = query.where(column >= datetime.combine(start, time.min, timezone.utc))
    if end and end < date.max: query = query.where(column < datetime.combine(end, time.min, timezone.utc) + timedelta(days=1))
    return query


@router.get('/purchases')
def my_purchases(response: Response, page: int = Query(1, ge=1), q: str = Query('', max_length=80),
                 kind: Kind | None = None, sort: Literal['new', 'old', 'cheap', 'expensive'] = 'new',
                 start: date | None = None, end: date | None = None,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    query = select(ShopPurchase).outerjoin(InventoryCatalog, InventoryCatalog.id == ShopPurchase.catalog_id).where(ShopPurchase.user_id == user.id)
    if q.strip(): query = query.where(ShopPurchase.name.ilike(search_pattern(q), escape='\\'))
    if kind: query = query.where(InventoryCatalog.kind == kind)
    query = period(query, ShopPurchase.created_at, start, end)
    order = {'new': ShopPurchase.created_at.desc(), 'old': ShopPurchase.created_at,
             'cheap': ShopPurchase.price, 'expensive': ShopPurchase.price.desc()}[sort]
    result = paginate(db, query, page, order, ShopPurchase.id)
    rows = result['items']
    kinds = dict(db.execute(select(InventoryCatalog.id, InventoryCatalog.kind).where(
        InventoryCatalog.id.in_([r.catalog_id for r in rows]))).all()) if rows else {}
    current = dict(db.execute(select(InventoryItem.id, usage_expression(user)).where(
        InventoryItem.id.in_([r.item_id for r in rows if r.item_id]),
        InventoryItem.owner_id == user.id, InventoryItem.revoked.is_(False))).all()) if rows else {}
    result['items'] = [{**receipt(r), 'kind': kinds.get(r.catalog_id), 'status': 'completed',
                        'owned': r.item_id in current, 'in_use': bool(current.get(r.item_id))}
                       for r in rows]
    return result


@router.get('/journal')
def my_journal(response: Response, page: int = Query(1, ge=1), q: str = Query('', max_length=80),
               kind: Kind | None = None,
               action: Literal['purchase', 'grant', 'gift', 'revoke', 'equip', 'unequip'] | None = None,
               start: date | None = None, end: date | None = None,
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    query = select(InventoryEvent).join(InventoryItem).join(InventoryCatalog).where(
        or_(InventoryEvent.actor_id == user.id, InventoryEvent.recipient_id == user.id))
    if kind: query = query.where(InventoryCatalog.kind == kind)
    if action: query = query.where(InventoryEvent.action == action)
    if q.strip(): query = query.where(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'))
    query = period(query, InventoryEvent.created_at, start, end)
    result = paginate(db, query, page, InventoryEvent.created_at.desc(), InventoryEvent.id)
    ids = [e.item_id for e in result['items']]
    details = {r.id: r for r in db.execute(select(InventoryItem.id, InventoryCatalog.id.label('catalog_id'),
        InventoryCatalog.name, InventoryCatalog.kind).join(InventoryCatalog).where(InventoryItem.id.in_(ids)))} if ids else {}
    result['items'] = [dict(id=e.id, item_id=e.item_id, action=e.action, created_at=e.created_at,
        catalog_id=details[e.item_id].catalog_id, name=details[e.item_id].name, kind=details[e.item_id].kind,
        direction='sent' if e.action == 'gift' and e.actor_id == user.id else 'received',
        status='completed') for e in result['items']]
    return result


@router.get('/admin/offers')
def admin_offers(kind: Kind | None = None, q: str = Query('', max_length=80), page: int = Query(1, ge=1),
                 user: User = Depends(manager), db: Session = Depends(get_db)):
    query = select(InventoryCatalog)
    if kind: query = query.where(InventoryCatalog.kind == kind)
    if q.strip(): query = query.where(InventoryCatalog.name.ilike(search_pattern(q), escape='\\'))
    result = paginate(db, query, page, InventoryCatalog.created_at.desc(), InventoryCatalog.id)
    result['items'] = [dict(id=e.id, name=e.name, kind=e.kind, hidden=e.hidden,
        **offer_data(db.get(ShopOffer, e.id)), sales=db.scalar(select(func.count()).select_from(ShopPurchase).where(ShopPurchase.catalog_id == e.id))) for e in result['items']]
    return result


class OfferEdit(BaseModel):
    price: int = Field(strict=True, ge=1, le=1_000_000_000)
    status: Literal['draft', 'published', 'withdrawn']
    position: int = Field(strict=True, ge=0, le=100000)
    recommended: bool = False
    version: int = Field(strict=True, ge=0)


@router.put('/admin/offers/{catalog_id}')
def edit_offer(catalog_id: str, body: OfferEdit, user: User = Depends(manager), db: Session = Depends(get_db)):
    lock_inventory(db)
    entry = db.get(InventoryCatalog, catalog_id)
    if not entry: raise HTTPException(404, 'Предмет не найден')
    if entry.hidden and body.status == 'published': raise HTTPException(409, 'Сначала верните предмет в каталог выдачи')
    offer = db.get(ShopOffer, catalog_id)
    if body.version != (offer.version if offer else 0): raise HTTPException(409, 'Предложение изменено. Обновите список.')
    before = offer_data(offer)
    if not offer:
        offer = ShopOffer(catalog_id=catalog_id, version=0)
        db.add(offer)
    for key in ('price', 'status', 'position', 'recommended'): setattr(offer, key, getattr(body, key))
    offer.version += 1
    db.add(ShopAudit(actor_id=user.id, actor_name=user.username, target=catalog_id, before=before, after=offer_data(offer)))
    db.commit()
    return offer_data(offer)


@router.get('/admin/purchases')
def purchases(page: int = Query(1, ge=1), q: str = Query('', max_length=80), user: User = Depends(manager), db: Session = Depends(get_db)):
    query = select(ShopPurchase)
    if q.strip(): query = query.where(ShopPurchase.name.ilike(search_pattern(q), escape='\\') | ShopPurchase.buyer_name.ilike(search_pattern(q), escape='\\'))
    result = paginate(db, query, page, ShopPurchase.created_at.desc(), ShopPurchase.id)
    result['items'] = [receipt(row) for row in result['items']]
    return result


@router.get('/admin/audit')
def audit(page: int = Query(1, ge=1), user: User = Depends(manager), db: Session = Depends(get_db)):
    result = paginate(db, select(ShopAudit), page, ShopAudit.created_at.desc(), ShopAudit.id)
    result['items'] = [dict(id=r.id, target=r.target, actor_name=r.actor_name, before=r.before, after=r.after, created_at=r.created_at) for r in result['items']]
    return result


class RoleEdit(BaseModel):
    enabled: bool


@router.put('/admin/managers/{user_id}')
def set_manager(user_id: UUID, body: RoleEdit, actor: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if not user: raise HTTPException(404, 'Пользователь не найден')
    db.add(ShopAudit(actor_id=actor.id, actor_name=actor.username, target=str(user_id),
                     before={'is_shop_admin': user.is_shop_admin}, after={'is_shop_admin': body.enabled}))
    user.is_shop_admin = body.enabled
    db.commit()
    return {'is_shop_admin': body.enabled}


class Purchase(BaseModel):
    request_id: UUID
    catalog_id: str = Field(min_length=1, max_length=64)
    expected_price: int = Field(strict=True, ge=1, le=1_000_000_000)
    offer_version: int = Field(strict=True, ge=1)


@router.get('/purchases/{request_id}')
def purchase_status(request_id: UUID, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    row = db.get(ShopPurchase, request_id)
    if not row or row.user_id != user.id: raise HTTPException(404, 'Покупка не найдена')
    return receipt(row)


@router.post('/purchases')
def purchase(body: Purchase, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Same lock order as inventory operations; balance row lock also serializes wallet adjustments.
    lock_inventory(db)
    db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': 'wallet:'+str(body.request_id)})
    previous = db.get(ShopPurchase, body.request_id)
    if previous:
        if (previous.user_id, previous.catalog_id, previous.price, previous.offer_version) != (user.id, body.catalog_id, body.expected_price, body.offer_version):
            raise HTTPException(409, 'Ключ операции уже использован')
        return {**receipt(previous), 'replayed': True}
    if db.get(WalletOperation, body.request_id) or db.scalar(select(InventoryEvent.id).where(InventoryEvent.request_id == body.request_id)):
        raise HTTPException(409, 'Ключ операции уже использован')
    offer = db.get(ShopOffer, body.catalog_id)
    entry = db.get(InventoryCatalog, body.catalog_id)
    if not offer or offer.status != 'published' or not entry or entry.hidden:
        raise HTTPException(409, 'Предмет больше не продаётся')
    if (offer.price, offer.version) != (body.expected_price, body.offer_version):
        raise HTTPException(409, 'Предложение изменилось. Обновите карточку и подтвердите покупку заново.')
    buyer = db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
    if buyer.crystals < offer.price: raise HTTPException(409, 'Недостаточно кристаллов')
    buyer.crystals -= offer.price
    item = InventoryItem(catalog_id=entry.id, kind=entry.kind, owner_id=buyer.id)
    db.add(item); db.flush()
    db.add(InventoryEvent(request_id=body.request_id, item_id=item.id, actor_id=buyer.id, recipient_id=buyer.id, action='purchase'))
    db.add(WalletOperation(id=body.request_id, user_id=buyer.id, actor_id=buyer.id, actor_name=buyer.username,
        currency='crystals', delta=-offer.price, balance_after=buyer.crystals, reason='Покупка: '+entry.name))
    row = ShopPurchase(id=body.request_id, user_id=buyer.id, buyer_name=buyer.username, catalog_id=entry.id,
        name=entry.name, item_id=item.id, price=offer.price, offer_version=offer.version, balance_after=buyer.crystals)
    db.add(row); db.commit()
    return {**receipt(row), 'replayed': False}
