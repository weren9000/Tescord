from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.routes.inventory import admin, paginate, person, search_pattern
from app.db.models import User
from app.db.inventory import InventoryBatch, InventoryCatalog, InventoryEvent, InventoryItem
from app.db.session import get_db
from app.services.inventory import lock_inventory

router = APIRouter(prefix='/inventory/batches', tags=['inventory'])


class GrantBatch(BaseModel):
    request_id: UUID
    catalog_ids: list[str] = Field(default_factory=list, max_length=500)
    recipient_ids: list[UUID] = Field(default_factory=list, max_length=500)
    skip_existing: bool = True
    retry_of: UUID | None = None


def owned_batch(db, key, actor):
    batch = db.get(InventoryBatch, key)
    if batch is None or batch.actor_id != actor.id:
        raise HTTPException(404, 'Операция не найдена')
    return batch


def pairs_for(body, db, actor):
    if body.retry_of:
        if body.catalog_ids or body.recipient_ids:
            raise HTTPException(422, 'При повторе используется список ошибок исходной операции')
        batch = owned_batch(db, body.retry_of, actor)
        pairs = [(r['catalog_id'], r['recipient_id']) for r in batch.result['rows'] if r['status'] == 'failed']
    else:
        catalogs, recipients = sorted(set(body.catalog_ids)), sorted(set(body.recipient_ids), key=str)
        if len(catalogs)*len(recipients)>500:
            raise HTTPException(422, 'Максимум 500 сочетаний за операцию')
        pairs = [(c, str(u)) for c in catalogs for u in recipients]
    if not 1 <= len(pairs) <= 500:
        raise HTTPException(422, 'Выберите предметы и получателей: от 1 до 500 сочетаний')
    return pairs


def evaluate(db, pairs, skip_existing, write=False, actor=None):
    catalog_ids = {c for c, _ in pairs}
    user_ids = {UUID(u) for _, u in pairs}
    entries = {c.id:c for c in db.scalars(select(InventoryCatalog).where(InventoryCatalog.id.in_(catalog_ids)))}
    people = {str(u.id):u for u in db.scalars(select(User).where(User.id.in_(user_ids)))}
    existing = set(db.execute(select(InventoryItem.catalog_id, cast(InventoryItem.owner_id, String)).where(
        InventoryItem.catalog_id.in_(catalog_ids), InventoryItem.owner_id.in_(user_ids), InventoryItem.revoked.is_(False))).all())
    rows=[]
    events=[]
    for catalog_id, recipient_id in pairs:
        entry, recipient = entries.get(catalog_id), people.get(recipient_id)
        row = dict(catalog_id=catalog_id, recipient_id=recipient_id,
                   name=entry.name if entry else catalog_id, nick=recipient.username if recipient else recipient_id)
        if not entry or entry.hidden:
            row.update(status='failed', reason='Предмет скрыт или недоступен')
        elif not recipient:
            row.update(status='failed', reason='Получатель больше недоступен')
        elif skip_existing and (catalog_id, recipient_id) in existing:
            row.update(status='skipped', reason='Уже есть в инвентаре')
        else:
            row.update(status='granted' if write else 'ready')
            if write:
                item = InventoryItem(id=uuid4(), catalog_id=catalog_id, kind=entry.kind, owner_id=recipient.id)
                db.add(item)
                events.append(InventoryEvent(request_id=uuid4(), item_id=item.id, actor_id=actor.id,
                                             recipient_id=recipient.id, action='grant'))
                row['item_id'] = str(item.id)
        rows.append(row)
    if write:
        db.flush()
        db.add_all(events)
    return dict(rows=rows, total=len(rows), granted=sum(r['status']=='granted' for r in rows),
                ready=sum(r['status']=='ready' for r in rows), skipped=sum(r['status']=='skipped' for r in rows),
                failed=sum(r['status']=='failed' for r in rows))


@router.get('/recipients')
def recipients(q: str = Query('', max_length=320), page: int = Query(1, ge=1),
               actor: User = Depends(admin), db: Session = Depends(get_db)):
    query = select(User)
    if q.strip():
        query = query.where(or_(User.username.ilike(search_pattern(q), escape='\\'),
                               func.lower(User.email)==q.strip().lower(), cast(User.public_id, String)==q.strip()))
    result = paginate(db, query, page, User.username, User.id)
    result['items'] = [dict(id=str(u.id), nick=u.username, public_id=u.public_id, avatar_updated_at=u.avatar_updated_at) for u in result['items']]
    return result


@router.post('/preview')
def preview(body: GrantBatch, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return evaluate(db, pairs_for(body, db, actor), body.skip_existing)


@router.post('')
def grant(body: GrantBatch, actor: User = Depends(admin), db: Session = Depends(get_db)):
    lock_inventory(db)
    payload = body.model_dump(mode='json', exclude={'request_id'})
    payload['catalog_ids'] = sorted(set(payload['catalog_ids']))
    payload['recipient_ids'] = sorted(set(payload['recipient_ids']))
    previous = db.get(InventoryBatch, body.request_id)
    if previous:
        if previous.actor_id != actor.id or previous.payload != payload:
            raise HTTPException(409, 'Ключ операции уже использован')
        return previous.result
    pairs = pairs_for(body, db, actor)
    result = evaluate(db, pairs, body.skip_existing, write=True, actor=actor)
    result['request_id'] = str(body.request_id)
    # Item, event and result are committed together: an interrupted response is safe to repeat.
    db.add(InventoryBatch(id=body.request_id, actor_id=actor.id, payload=payload, result=result))
    db.commit()
    return result


@router.get('')
def history(actor: User = Depends(admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(InventoryBatch).where(InventoryBatch.actor_id==actor.id).order_by(InventoryBatch.created_at.desc()).limit(20))
    return [dict(id=str(b.id), created_at=b.created_at, granted=b.result['granted'], skipped=b.result['skipped'], failed=b.result['failed']) for b in rows]


@router.get('/{key}')
def result(key: UUID, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return owned_batch(db, key, actor).result
