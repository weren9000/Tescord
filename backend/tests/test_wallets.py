from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4
from sqlalchemy import select
from app.db.models import User, WalletOperation
from app.db.session import SessionLocal
from test_inventory import accounts


def admin(users):
    with SessionLocal() as db:
        db.get(User, UUID(users[0][1]['id'])).is_admin = True
        db.commit()
    return users[0][0]


def payload(amount=100, currency='coins', action='credit', before=0):
    return dict(request_id=str(uuid4()), currency=currency, action=action, amount=amount,
                reason='Test reward', expected_balance=before)


def test_permissions_and_private_balances(accounts):
    c, users = accounts
    a, alice, _ = users[0]  # avatar admin alone must not manage money
    b, bob, _ = users[1]
    path='/api/admin/wallets/'+bob['id']
    assert c.get('/api/wallet').status_code == 401
    assert c.get(path, headers=a).status_code == 403
    assert c.post(path+'/adjust', headers=a, json=payload()).status_code == 403
    assert c.post(path+'/adjust', headers=b, json=payload()).status_code == 403
    wallet=c.get('/api/wallet', headers=b).json()
    assert wallet['coins']==wallet['crystals']==0 and wallet['items']==[]
    assert 'coins' not in c.get('/api/me',headers=b).json()


def test_credit_debit_history_and_idempotent_retry(accounts):
    c, users = accounts
    a=admin(users);b,bob,_=users[1]
    path='/api/admin/wallets/'+bob['id']+'/adjust'
    credit=payload()
    assert c.post(path,headers=a,json=credit).status_code==200
    assert c.post(path,headers=a,json=credit).json()['replayed'] is True
    assert c.post(path,headers=a,json={**credit,'amount':999}).status_code==409
    assert c.post(path,headers=a,json=payload(30,action='debit',before=100)).status_code==200
    assert c.post(path,headers=a,json=payload(5,currency='crystals')).status_code==200
    wallet=c.get('/api/wallet',headers=b).json()
    assert (wallet['coins'],wallet['crystals'],wallet['total'])==(70,5,3)
    assert all('actor_id' not in row for row in wallet['items'])
    assert c.get(path.removesuffix('/adjust'),headers=a).json()['items'][0]['actor_id']==users[0][1]['id']
    assert c.post(path,headers=a,json=payload(71,action='debit',before=70)).status_code==409
    assert c.post(path,headers=a,json=payload(1,before=0)).status_code==409
    for invalid in ({'amount':0},{'amount':-1},{'amount':1.5},{'amount':True},{'currency':'usd'},{'reason':'   '}):
        assert c.post(path,headers=a,json={**payload(before=70),**invalid}).status_code==422
    assert c.get('/api/wallet',headers=b).json()['total']==3


def test_concurrent_retries_and_spending(accounts):
    c, users = accounts;a=admin(users);b,bob,_=users[1]
    path='/api/admin/wallets/'+bob['id']+'/adjust';credit=payload()
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda _: c.post(path,headers=a,json=credit),range(4)))
    assert all(r.status_code==200 for r in responses)
    assert sum(not r.json()['replayed'] for r in responses)==1
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _: c.post(path,headers=a,json=payload(80,action='debit',before=100)),range(2)))
    assert sorted(r.status_code for r in responses)==[200,409]
    wallet=c.get('/api/wallet',headers=b).json()
    assert wallet['coins']==20 and wallet['total']==2


def test_history_pages_and_self_adjustment(accounts):
    c, users=accounts;a=admin(users);path='/api/admin/wallets/'+users[0][1]['id']+'/adjust'
    for before in range(21):
        assert c.post(path,headers=a,json=payload(1,before=before)).status_code==200
    page=c.get('/api/wallet',headers=a,params={'page':2}).json()
    assert page['coins']==21 and page['pages']==2 and len(page['items'])==1
    assert c.get('/api/wallet',headers=a,params={'page':0}).status_code==422
