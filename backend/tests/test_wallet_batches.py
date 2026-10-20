from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4
from sqlalchemy import select
from app.db.models import User, WalletOperation
from app.db.inventory import InventoryCatalog, InventoryItem
from app.db.session import SessionLocal
from test_inventory import accounts
from test_wallets import admin, payload


def batch(users, **kwargs):
    return dict(request_id=str(uuid4()), user_ids=[u[1]['id'] for u in users],
                currency='coins', action='credit', amount=50, reason='Batch test', **kwargs)


def test_batch_permissions_and_validation(accounts):
    c, users = accounts
    body = batch(users)
    assert c.post('/api/admin/wallet-batches/preview', json=body, headers=users[0][0]).status_code == 403
    a = admin(users)
    for changed in ({'amount': True}, {'amount': -1}, {'reason': ' '},
                    {'user_ids': []}, {'user_ids': [users[0][1]['id']]*2}):
        assert c.post('/api/admin/wallet-batches/preview', json={**body, **changed}, headers=a).status_code == 422


def test_batch_preview_frozen_and_concurrent_confirm(accounts):
    c, users = accounts; a = admin(users)
    body = batch(users)
    path = '/api/admin/wallet-batches'
    preview = c.post(path+'/preview', json=body, headers=a)
    assert preview.status_code == 200, preview.text
    assert all(row['before'] == 0 and row['after'] == 50 for row in preview.json()['items'])
    assert c.get('/api/wallet', headers=a).json()['coins'] == 0
    assert c.post(path+'/preview', json={**body, 'amount': 99}, headers=a).status_code == 409
    # A balance changed between preview and confirmation must not be silently adjusted.
    assert c.post('/api/admin/wallets/'+users[1][1]['id']+'/adjust', headers=a, json=payload(3)).status_code == 200
    confirm = path+'/'+body['request_id']+'/confirm'
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(pool.map(lambda _: c.post(confirm, headers=a), range(3)))
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == responses[0].json() for r in responses)
    result = responses[0].json()
    assert result['applied'] == len(users)-1
    skipped = next(r for r in result['items'] if r['user_id'] == users[1][1]['id'])
    assert skipped['status'] == 'skipped' and skipped['before'] == skipped['after'] == 3
    assert c.post(path+'/preview', json=body, headers=a).json() == result
    with SessionLocal() as db:
        assert len(db.scalars(select(WalletOperation).where(WalletOperation.reason == 'Batch test')).all()) == len(users)-1


def test_batch_insufficient_funds_and_missing_recipient(accounts):
    c, users = accounts; a = admin(users)
    body = {**batch(users), 'action': 'debit', 'user_ids': [users[0][1]['id'], str(uuid4())]}
    assert c.post('/api/admin/wallet-batches/preview', json=body, headers=a).status_code == 200
    result = c.post('/api/admin/wallet-batches/'+body['request_id']+'/confirm', headers=a).json()
    assert result['applied'] == 0 and all(r['error'] for r in result['items'])
    assert c.get('/api/wallet', headers=a).json()['coins'] == 0


def test_directory_balances_selection_and_inventory(accounts):
    c, users = accounts; a = admin(users); key = users[1][1]['id']
    catalog_id = str(uuid4())
    with SessionLocal() as db:
        db.add(InventoryCatalog(id=catalog_id, name='Unique batch frame', kind='frame', rarity='rare', builtin=False, created_by=UUID(users[0][1]['id'])))
        db.flush()
        for revoked in (False, False, True):
            db.add(InventoryItem(catalog_id=catalog_id, kind='frame', owner_id=UUID(key), revoked=revoked))
        db.commit()
    path = '/api/admin/directory/users'
    selected = c.get(path, params={'selection': True, 'item': 'Unique batch frame'}, headers=a)
    assert selected.status_code == 200, selected.text
    assert selected.json()['user_ids'] == [key]
    listing = c.get(path, params={'item': 'Unique batch frame', 'sort_by': 'inventory_count'}, headers=a).json()
    assert listing['items'][0]['inventory_count'] == 2
    inventory = c.get(path+'/'+key+'/inventory', headers=a)
    assert inventory.status_code == 200, inventory.text
    assert inventory.json()['items'][0]['copies'] == 2
    assert c.get(path+'/'+key+'/inventory', params={'kind': 'avatar'}, headers=a).json()['total'] == 0
    assert c.get(path+'/'+key+'/inventory', headers=users[1][0]).status_code == 403


def test_batch_crystal_debit_partial_success_and_private_result(accounts):
    c, users = accounts; a = admin(users)
    key = users[0][1]['id']
    assert c.post('/api/admin/wallets/'+key+'/adjust', headers=a, json=payload(60, currency='crystals')).status_code == 200
    body = {**batch(users), 'currency': 'crystals', 'action': 'debit'}
    path = '/api/admin/wallet-batches'
    assert c.post(path+'/preview', headers=a, json=body).status_code == 200
    with SessionLocal() as db:
        db.get(User, UUID(users[1][1]['id'])).is_admin = True
        db.commit()
    assert c.post(path+'/'+body['request_id']+'/confirm', headers=users[1][0]).status_code == 404
    result = c.post(path+'/'+body['request_id']+'/confirm', headers=a).json()
    assert result['applied'] == 1
    wallet = c.get('/api/admin/wallets/'+key, headers=a).json()
    assert wallet['crystals'] == 10
    assert wallet['items'][0]['batch_id'] == body['request_id']
