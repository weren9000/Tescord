from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.api.routes.admin_directory import require_admin
from app.db.models import User, WalletOperation
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
                       **({'actor_id': r.actor_id, 'actor_name': r.actor_name} if admin else {})} for r in rows]}


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
