from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4
from sqlalchemy import func, select
from app.db.models import User
from app.db.inventory import InventoryCatalog, InventoryItem, InventoryBatch
from app.db.session import SessionLocal
from test_inventory import accounts


def body(users, catalogs=None):
    return dict(request_id=str(uuid4()), catalog_ids=catalogs or ['cyber-oni','frame-neon'],
                recipient_ids=[u[1]['id'] for u in users], skip_existing=True)


def test_batch_permissions_and_recipient_privacy(accounts):
    c,users=accounts;admin,profile,_=users[0];regular,user,_=users[1]
    data=body(users[1:])
    for method,path,payload in [('get','/recipients',None),('get','',None),('post','/preview',data),('post','',data),('get','/'+str(uuid4()),None)]:
        r=c.request(method,'/api/inventory/batches'+path,headers=regular,json=payload)
        assert r.status_code==403
    r=c.get('/api/inventory/batches/recipients',headers=admin,params={'q':user['email']})
    assert r.status_code==200 and r.json()['total']==1
    assert set(r.json()['items'][0])=={'id','nick','public_id','avatar_updated_at'}
    assert c.get('/api/inventory/batches/recipients',headers=admin,params={'q':str(user['public_id'])}).json()['total']==1
    with SessionLocal() as db:
        u=db.get(User,UUID(profile['id']));u.is_avatar_admin=False;u.is_admin=True;db.commit()
    assert c.get('/api/inventory/catalog',headers=admin).status_code==200
    assert c.post('/api/inventory/batches/preview',headers=admin,json=data).json()['ready']==4
    assert c.post('/api/inventory/batches',headers=admin,json=data).json()['granted']==4


def test_batch_concurrent_replay_skip_and_duplicates(accounts):
    c,users=accounts;headers=users[0][0];data=body(users[1:])
    preview=c.post('/api/inventory/batches/preview',headers=headers,json=data)
    assert preview.status_code==200 and preview.json()['ready']==4
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:c.post('/api/inventory/batches',headers=headers,json=data),range(2)))
    assert all(r.status_code==200 for r in responses)
    assert responses[0].json()==responses[1].json()
    result=responses[0].json();assert result['granted']==4
    assert c.get('/api/inventory/batches/'+data['request_id'],headers=headers).json()==result
    assert c.post('/api/inventory/batches',headers=headers,json={**data,'skip_existing':False}).status_code==409
    skipped=c.post('/api/inventory/batches',headers=headers,json={**data,'request_id':str(uuid4())}).json()
    assert skipped['skipped']==4 and skipped['granted']==0
    extra=c.post('/api/inventory/batches',headers=headers,json={**data,'request_id':str(uuid4()),'skip_existing':False}).json()
    assert extra['granted']==4
    with SessionLocal() as db:
        rows=db.scalars(select(InventoryItem).where(InventoryItem.owner_id.in_([UUID(x) for x in data['recipient_ids']]))).all()
        assert len(rows)==8 and not any(x.equipped for x in rows)
    assert len(c.get('/api/inventory/batches',headers=headers).json())==3


def test_batch_failed_only_retry_and_revoked_items(accounts):
    c,users=accounts;headers,admin,_=users[0];recipient=users[1][1];key=str(uuid4())
    with SessionLocal() as db:
        db.add(InventoryCatalog(id=key,name='Batch hidden',kind='avatar',builtin=False,hidden=True,created_by=UUID(admin['id'])));db.commit()
    data=body(users[1:2],['cyber-oni',key])
    first=c.post('/api/inventory/batches',headers=headers,json=data).json()
    assert first['granted']==1 and first['failed']==1
    with SessionLocal() as db:
        db.get(InventoryCatalog,key).hidden=False;db.commit()
    retry=dict(request_id=str(uuid4()),retry_of=data['request_id'],skip_existing=True)
    assert c.post('/api/inventory/batches/preview',headers=headers,json=retry).json()['ready']==1
    result=c.post('/api/inventory/batches',headers=headers,json=retry).json()
    assert result['granted']==1 and result['total']==1
    with SessionLocal() as db:
        item=db.scalar(select(InventoryItem).where(InventoryItem.owner_id==UUID(recipient['id']),InventoryItem.catalog_id=='cyber-oni'))
        item.revoked=True;db.commit()
    assert c.post('/api/inventory/batches',headers=headers,json=body(users[1:2],['cyber-oni'])).json()['granted']==1


def test_batch_limits_deduplication_and_cross_actor_result(accounts):
    c,users=accounts;headers=users[0][0];data=body(users[1:2],['cyber-oni','cyber-oni'])
    data['recipient_ids']*=2
    r=c.post('/api/inventory/batches',headers=headers,json=data);assert r.status_code==200 and r.json()['total']==1
    with SessionLocal() as db:
        db.get(User,UUID(users[2][1]['id'])).is_avatar_admin=True;db.commit()
    assert c.get('/api/inventory/batches/'+data['request_id'],headers=users[2][0]).status_code==404
    assert c.post('/api/inventory/batches',headers=users[2][0],json=data).status_code==409
    excessive={**data,'request_id':str(uuid4()),'catalog_ids':[str(i) for i in range(26)],'recipient_ids':[str(uuid4()) for _ in range(20)]}
    assert c.post('/api/inventory/batches',headers=headers,json=excessive).status_code==422
    assert c.post('/api/inventory/batches',headers=headers,json={**data,'request_id':str(uuid4()),'catalog_ids':[]}).status_code==422
