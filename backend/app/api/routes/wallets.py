from typing import Literal
from uuid import UUID, uuid5
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.api.routes.admin_directory import require_admin
from app.db.models import User, WalletOperation, WalletBatch
from app.db.session import get_db

router = APIRouter(tags=['wallets'])
MAX_BALANCE = 9_000_000_000_000


class Adjustment(BaseModel):
    request_id: UUID
    currency: Literal['coins', 'crystals']
    action: Literal['credit', 'debit']
    amount: int = Field(strict=True, ge=1, le=1_000_000_000)
    expected_balance: int = Field(strict=True, ge=0, le=MAX_BALANCE)
    reason: str = Field(min_length=1, max_length=240)

    @field_validator('reason')
    @classmethod
    def clean_reason(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Укажите причину')
        return value


def balances(user):
    return {'coins': user.coins, 'crystals': user.crystals}


class BatchAdjustment(BaseModel):
    request_id: UUID
    currency: Literal['coins', 'crystals']
    action: Literal['credit', 'debit']
    amount: int = Field(strict=True, ge=1, le=1_000_000_000)
    reason: str = Field(min_length=1, max_length=240)
    user_ids: list[UUID] = Field(min_length=1, max_length=1000)

    @field_validator('reason')
    @classmethod
    def clean_reason(cls, value):
        return Adjustment.clean_reason(value)

    @field_validator('user_ids')
    @classmethod
    def unique_users(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Пользователь указан повторно')
        return sorted(value, key=str)


def batch_rows(db, payload, lock=False):
    query = select(User).where(User.id.in_(payload.user_ids)).order_by(User.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    users = {u.id: u for u in db.scalars(query)}
    delta = payload.amount if payload.action == 'credit' else -payload.amount
    rows = []
    for key in payload.user_ids:
        user = users.get(key)
        before = getattr(user, payload.currency) if user else None
        after = before + delta if user else None
        error = ('Пользователь удалён' if not user else 'Недостаточно средств' if after < 0
                 else 'Превышен максимальный баланс' if after > MAX_BALANCE else '')
        rows.append(dict(user_id=str(key), name=user.username if user else str(key),
                         before=before, after=after if not error else before, error=error))
    return users, rows


@router.post('/admin/wallet-batches/preview')
def preview_batch(payload: BatchAdjustment, actor: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {'key': 'wallet-batch:'+str(payload.request_id)})
    data = payload.model_dump(mode='json')
    previous = db.get(WalletBatch, payload.request_id)
    if previous:
        if previous.actor_id != actor.id or previous.payload != data:
            raise HTTPException(409, 'Ключ операции уже использован')
        return previous.result
    _, rows = batch_rows(db, payload)
    result = dict(batch_id=str(payload.request_id), state='preview', items=rows)
    db.add(WalletBatch(id=payload.request_id, actor_id=actor.id, payload=data, result=result))
    db.commit()
    return result


@router.post('/admin/wallet-batches/{batch_id}/confirm')
def confirm_batch(batch_id: UUID, actor: User = Depends(require_admin), db: Session = Depends(get_db)):
    batch = db.scalar(select(WalletBatch).where(WalletBatch.id == batch_id).with_for_update())
    if not batch or batch.actor_id != actor.id:
        raise HTTPException(404, 'Операция не найдена')
    if batch.result['state'] == 'complete':
        return batch.result
    payload = BatchAdjustment.model_validate(batch.payload)
    users, rows = batch_rows(db, payload, lock=True)
    expected = {r['user_id']: r for r in batch.result['items']}
    delta = payload.amount if payload.action == 'credit' else -payload.amount
    for row in rows:
        original = expected[row['user_id']]
        if original['error']:
            row['error'] = original['error']
        elif row['before'] != original['before']:
            row['error'] = 'Баланс изменился. Требуется новая проверка'
        if row['error']:
            row['after'] = row['before']
            row['status'] = 'skipped'
            continue
        user = users[UUID(row['user_id'])]
        setattr(user, payload.currency, row['after'])
        operation_id = uuid5(batch.id, row['user_id'])
        db.add(WalletOperation(id=operation_id, user_id=user.id, actor_id=actor.id,
            actor_name=actor.username, currency=payload.currency, delta=delta,
            balance_after=row['after'], reason=payload.reason, batch_id=batch.id))
        row.update(status='applied', operation_id=str(operation_id))
    batch.result = dict(batch_id=str(batch.id), state='complete', items=rows,
                        applied=sum(r['status'] == 'applied' for r in rows))
    db.commit()
    return batch.result


def wallet_page(user, db, page, admin=False):
    total = db.scalar(select(func.count()).select_from(WalletOperation).where(WalletOperation.user_id == user.id))
    pages = max(1, (total + 19) // 20)
    page = min(page, pages)
    rows = db.scalars(select(WalletOperation).where(WalletOperation.user_id == user.id)
                      .order_by(WalletOperation.created_at.desc(), WalletOperation.id.desc()).offset((page-1)*20).limit(20)).all()
    return {**balances(user), 'user_id': user.id, 'nick': user.username, 'public_id': user.public_id,
            'page': page, 'pages': pages, 'total': total,
            'items': [{'id': r.id, 'currency': r.currency, 'delta': r.delta, 'balance_after': r.balance_after,
                       'reason': r.reason, 'created_at': r.created_at,
                       **({'actor_id': r.actor_id, 'actor_name': r.actor_name, 'batch_id': r.batch_id} if admin else {})} for r in rows]}


@router.get('/wallet')
def own_wallet(response: Response, page: int = Query(1, ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return wallet_page(user, db, page)


@router.get('/admin/wallets/{user_id}')
def admin_wallet(user_id: UUID, page: int = Query(1, ge=1), actor: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, 'Пользователь не найден')
    return wallet_page(user, db, page, admin=True)


@router.post('/admin/wallets/{user_id}/adjust')
def adjust_wallet(user_id: UUID, payload: Adjustment, actor: User = Depends(require_admin), db: Session = Depends(get_db)):
    # Serialize retries of the same request, then lock the target balance against concurrent spending.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {'key': 'wallet:'+str(payload.request_id)})
    previous = db.get(WalletOperation, payload.request_id)
    delta = payload.amount if payload.action == 'credit' else -payload.amount
    if previous:
        if (previous.user_id, previous.actor_id, previous.currency, previous.delta, previous.reason) != (user_id, actor.id, payload.currency, delta, payload.reason):
            raise HTTPException(409, 'Этот запрос уже использован для другой операции')
        return {'operation_id': previous.id, 'balance_after': previous.balance_after, 'replayed': True}
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise HTTPException(404, 'Пользователь не найден')
    if getattr(user, payload.currency) != payload.expected_balance:
        raise HTTPException(409, 'Баланс изменился. Проверьте сумму и подтвердите операцию заново.')
    after = getattr(user, payload.currency) + delta
    if after < 0:
        raise HTTPException(409, 'Недостаточно средств для списания')
    if after > MAX_BALANCE:
        raise HTTPException(409, 'Превышен максимальный баланс')
    setattr(user, payload.currency, after)
    db.add(WalletOperation(id=payload.request_id, user_id=user.id, actor_id=actor.id, actor_name=actor.username,
                           currency=payload.currency, delta=delta, balance_after=after, reason=payload.reason))
    db.commit()
    return {'operation_id': payload.request_id, 'balance_after': after, 'replayed': False}
