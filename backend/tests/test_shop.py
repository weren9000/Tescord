from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select, delete
from app.db.models import User, WalletOperation
from app.db.shop import ShopOffer, ShopPurchase, ShopAudit
from app.db.inventory import InventoryCatalog, InventoryItem, InventoryEvent
from app.db.session import SessionLocal
from test_inventory import accounts


@pytest.fixture
def store(accounts):
    c, users = accounts
    catalog_id = 'test-shop-'+uuid4().hex
    with SessionLocal() as db:
        db.get(User, UUID(users[0][1]['id'])).is_admin = True
        db.get(User, UUID(users[1][1]['id'])).crystals = 250
        db.add(InventoryCatalog(id=catalog_id, name='Test Shop', kind='avatar', builtin=True))
        db.commit()
    try: yield c, users, catalog_id
    finally:
        with SessionLocal() as db:
            db.execute(delete(ShopPurchase).where(ShopPurchase.catalog_id == catalog_id))
            db.execute(delete(ShopAudit).where(ShopAudit.actor_id.in_([UUID(u[1]['id']) for u in users])))
            db.execute(delete(ShopOffer).where(ShopOffer.catalog_id == catalog_id))
            items=select(InventoryItem.id).where(InventoryItem.catalog_id==catalog_id)
            db.execute(delete(InventoryEvent).where(InventoryEvent.item_id.in_(items)))
            db.execute(delete(InventoryItem).where(InventoryItem.catalog_id==catalog_id))
            db.execute(delete(InventoryCatalog).where(InventoryCatalog.id==catalog_id))
            db.commit()


def offer(c, headers, key, **kw):
    return c.put('/api/shop/admin/offers/'+key, headers=headers,
        json=dict(price=100, status='published', position=0, recommended=False, version=0, **kw))


def buy(key, **kw):
    return dict(request_id=str(uuid4()), catalog_id=key, expected_price=100, offer_version=1, **kw)


def test_permissions_publication_audit_and_price_validation(store):
    c,users,key=store;a=users[0][0];b=users[1][0];d=users[2][0]
    assert c.get('/api/shop').status_code==401
    assert offer(c,b,key).status_code==403
    assert c.put('/api/shop/admin/managers/'+users[2][1]['id'],headers=b,json={'enabled':True}).status_code==403
    assert c.put('/api/shop/admin/managers/'+users[2][1]['id'],headers=a,json={'enabled':True}).status_code==200
    assert c.get('/api/me',headers=d).json()['is_shop_admin']
    assert offer(c,d,key).status_code==200
    assert c.get('/api/shop',headers=b,params={'q':'Test Shop'}).json()['total']==1
    payload=dict(price=0,status='draft',position=0,version=1)
    for invalid in (0,-1,True,1.5):
        assert c.put('/api/shop/admin/offers/'+key,headers=d,json={**payload,'price':invalid}).status_code==422
    assert offer(c,d,key).status_code==409
    assert c.get('/api/shop/admin/audit',headers=d).json()['total']>=2
    assert c.get('/api/admin/wallets/'+users[1][1]['id'],headers=d).status_code==403


def test_atomic_purchase_retry_history_gift_and_grouping(store):
    c,users,key=store;a=users[0][0];b=users[1][0];d=users[2][0]
    assert offer(c,a,key).status_code==200
    payload=buy(key)
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses=list(pool.map(lambda _:c.post('/api/shop/purchases',headers=b,json=payload),range(3)))
    assert all(r.status_code==200 for r in responses)
    assert sum(not r.json()['replayed'] for r in responses)==1
    first=responses[0].json()
    assert first['balance_after']==150
    assert c.get('/api/shop/purchases/'+payload['request_id'],headers=d).status_code==404
    assert c.get('/api/shop/purchases/'+payload['request_id'],headers=b).json()['item_id']==first['item_id']
    assert c.post('/api/shop/purchases',headers=d,json=payload).status_code==409
    assert c.post('/api/shop/purchases',headers=b,json={**payload,'expected_price':99}).status_code==409
    second=c.post('/api/shop/purchases',headers=b,json=buy(key));assert second.status_code==200
    inv=c.get('/api/inventory',headers=b,params={'grouped':True}).json()
    assert inv['total']==1 and inv['items'][0]['copies']==2
    assert any(n['action']=='purchase' for n in inv['notifications'])
    gift=c.post('/api/inventory/items/'+second.json()['item_id']+'/gift',headers=b,json={'request_id':str(uuid4()),'recipient_id':users[2][1]['id']})
    assert gift.status_code==200
    assert c.get('/api/inventory',headers=d).json()['items'][0]['id']==second.json()['item_id']
    wallet=c.get('/api/wallet',headers=b).json()
    assert wallet['crystals']==50 and wallet['total']==2
    assert all(r['currency']=='crystals' and r['delta']==-100 for r in wallet['items'])
    assert c.post('/api/shop/purchases',headers=b,json=buy(key)).status_code==409


def test_changed_price_withdrawal_and_concurrent_balance(store):
    c,users,key=store;a=users[0][0];b=users[1][0]
    assert offer(c,a,key).status_code==200
    update={'price':200,'status':'published','position':0,'version':1}
    assert c.put('/api/shop/admin/offers/'+key,headers=a,json=update).status_code==200
    assert c.post('/api/shop/purchases',headers=b,json=buy(key)).status_code==409
    payload={**buy(key),'expected_price':200,'offer_version':2}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:c.post('/api/shop/purchases',headers=b,json={**payload,'request_id':str(uuid4())}),range(2)))
    assert sorted(r.status_code for r in responses)==[200,409]
    assert c.get('/api/wallet',headers=b).json()['crystals']==50
    assert c.put('/api/shop/admin/offers/'+key,headers=a,json={**update,'version':2,'status':'withdrawn'}).status_code==200
    assert c.get('/api/shop',headers=b,params={'q':'Test Shop'}).json()['total']==0
    assert c.get('/api/inventory',headers=b).json()['total']==1
    assert c.post('/api/shop/purchases',headers=b,json=payload).status_code==409


def test_wallet_adjustment_and_purchase_share_balance_lock(store):
    c,users,key=store;a=users[0][0];b=users[1][0]
    assert offer(c,a,key).status_code==200
    def purchase():return c.post('/api/shop/purchases',headers=b,json=buy(key))
    def debit():return c.post('/api/admin/wallets/'+users[1][1]['id']+'/adjust',headers=a,json={
        'request_id':str(uuid4()),'currency':'crystals','action':'debit','amount':200,'expected_balance':250,'reason':'Concurrent debit'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=[f.result() for f in [pool.submit(purchase),pool.submit(debit)]]
    assert sorted(r.status_code for r in responses)==[200,409]
    assert c.get('/api/wallet',headers=b).json()['crystals'] in (50,150)


def test_grouped_inventory_does_not_split_copies_and_tracks_wallpapers(store):
    c,users,key=store;b=users[1][0];user_id=UUID(users[1][1]['id'])
    with SessionLocal() as db:
        entry=db.get(InventoryCatalog,key);entry.kind='wallpaper'
        copies=[InventoryItem(catalog_id=key,kind='wallpaper',owner_id=user_id) for _ in range(24)]
        db.add_all(copies);db.flush()
        used=str(copies[0].id);db.get(User,user_id).chat_wallpaper='item:'+used;db.commit()
    data=c.get('/api/inventory',headers=b,params={'grouped':True,'equipped_only':True}).json()
    assert data['total']==data['pages']==1
    item=data['items'][0]
    assert item['copies']==24 and item['in_use'] and item['id']==used
    assert item['gift_item_id']!=used
    assert c.get('/api/inventory',headers=b,params={'grouped':True,'q':'no-match'}).json()['total']==0


def test_personal_receipts_and_journal_are_private_and_survive_gifts(store):
    c,users,key=store;a,b,d=[u[0] for u in users]
    assert offer(c,a,key).status_code==200
    purchase=c.post('/api/shop/purchases',headers=b,json=buy(key)).json()
    for path in ['/api/shop/purchases','/api/shop/journal']:
        assert c.get(path).status_code==401
        assert c.get(path,headers=d).json()['total']==0
    data=c.get('/api/shop/purchases',headers=b).json()
    assert data['total']==1 and data['items'][0]['owned']
    assert data['items'][0]['price']==100 and data['items'][0]['kind']=='avatar'
    assert c.get('/api/shop/admin/purchases',headers=b).status_code==403
    assert c.post('/api/inventory/items/'+purchase['item_id']+'/equip',headers=b,json={'request_id':str(uuid4())}).status_code==200
    assert c.get('/api/shop/purchases',headers=b).json()['items'][0]['in_use']
    assert c.post('/api/inventory/items/'+purchase['item_id']+'/gift',headers=b,json={'request_id':str(uuid4()),'recipient_id':users[2][1]['id']}).status_code==200
    receipt=c.get('/api/shop/purchases',headers=b).json()['items'][0]
    assert not receipt['owned'] and not receipt['in_use'] and receipt['price']==100
    assert c.get('/api/shop/purchases',headers=d).json()['total']==0
    sender=c.get('/api/shop/journal',headers=b,params={'action':'gift'}).json()['items']
    recipient=c.get('/api/shop/journal',headers=d,params={'action':'gift'}).json()['items']
    assert len(sender)==len(recipient)==1
    assert sender[0]['direction']=='sent' and recipient[0]['direction']=='received'
    assert 'owner_id' not in sender[0] and 'recipient_id' not in sender[0]
    assert c.get('/api/shop/journal',headers=a).json()['total']==0
    for path in ['/api/shop/purchases','/api/shop/journal']:
        assert c.get(path,headers=b,params={'q':'absent'}).json()['total']==0
        assert c.get(path,headers=b,params={'kind':'theme'}).json()['total']==0
        assert c.get(path,headers=b,params={'start':'2100-01-02','end':'2000-01-01'}).status_code==422
        assert c.get(path,headers=b,params={'end':'2000-01-01'}).json()['total']==0
        assert c.get(path,headers=b,params={'end':'9999-12-31'}).status_code==200


def test_catalog_price_recommendation_and_real_facets(store):
    c,users,key=store;a,b,_=[u[0] for u in users]
    assert offer(c,a,key).status_code==200
    def get(**params):return c.get('/api/shop',headers=b,params={'q':'Test Shop',**params})
    assert get().json()['categories']=={'avatar':1}
    assert get(kind='theme').json()['total']==0
    assert get(kind='theme').json()['categories']=={'avatar':1}
    assert get(min_price=101).json()['total']==0
    assert get(max_price=99).json()['total']==0
    assert get(min_price=100,max_price=100).json()['total']==1
    assert get(min_price=101,max_price=100).status_code==422
    assert get(recommended=True).json()['total']==0
    assert c.post('/api/shop/purchases',headers=b,json=buy(key)).status_code==200
    assert get().json()['items'][0]['owned']==1
    assert get(unowned=True).json()['categories']=={}


def test_favorites_private_idempotent_and_rarity_optional(store):
    c,users,key=store;a,b,d=[u[0] for u in users]
    assert offer(c,a,key).status_code==200
    assert c.get('/api/shop',headers=b,params={'q':'Test Shop'}).json()['items'][0]['rarity'] is None
    path='/api/shop/favorites/'+key
    assert c.put(path,json={'enabled':True}).status_code==401
    for _ in range(2):assert c.put(path,headers=b,json={'enabled':True}).json()['favorite']
    result=c.get('/api/shop',headers=b,params={'favorites':True,'count_only':True}).json()
    assert result['total']==1
    assert c.get('/api/shop',headers=d,params={'favorites':True}).json()['total']==0
    payload=dict(price=100,status='published',position=0,recommended=False,version=1,rarity='rare')
    assert c.put('/api/shop/admin/offers/'+key,headers=b,json=payload).status_code==403
    assert c.put('/api/shop/admin/offers/'+key,headers=a,json=payload).status_code==200
    assert c.get('/api/shop',headers=b,params={'rarity':'rare','favorites':True}).json()['total']==1
    assert c.get('/api/shop',headers=b,params={'rarity':'epic','favorites':True}).json()['total']==0
    assert c.get('/api/shop',headers=b,params={'rarity':'invented'}).status_code==422
    assert c.put(path,headers=b,json={'enabled':False}).json()['favorite'] is False
    assert c.get('/api/shop',headers=b,params={'favorites':True}).json()['total']==0


def test_collections_editor_permissions_versions_and_public_visibility(store):
    from app.db.shop import ShopCollection, ShopCollectionItem
    c,users,key=store;a,b,d=[u[0] for u in users]
    assert offer(c,a,key).status_code==200
    group=str(uuid4());url='/api/shop/admin/collections/'+group
    body=dict(name='Test selection',description='Real catalog',cover_id=key,items=[key],published=False,position=1,version=0)
    assert c.put(url,headers=b,json=body).status_code==403
    assert c.get('/api/shop/admin/collections',headers=b).status_code==403
    try:
        assert c.put(url,headers=a,json=body).status_code==200
        assert all(g['id']!=group for g in c.get('/api/shop/collections',headers=b).json())
        assert c.get('/api/shop',headers=b,params={'collection':group}).status_code==404
        assert c.put(url,headers=a,json=body).status_code==409
        assert c.put(url,headers=a,json={**body,'version':1,'published':True}).status_code==200
        groups=c.get('/api/shop/collections',headers=b).json()
        assert next(g for g in groups if g['id']==group)['total']==1
        assert c.get('/api/shop',headers=b,params={'collection':group,'count_only':True}).json()['total']==1
        assert c.get('/api/shop',headers=b,params={'collection':group,'kind':'theme'}).json()['total']==0
        assert c.put(url,headers=a,json={**body,'version':2,'cover_id':'missing'}).status_code==422
        assert c.put(url,headers=a,json={**body,'version':2,'items':['missing']}).status_code==422
        assert c.put('/api/shop/admin/offers/'+key,headers=a,json={'price':100,'status':'withdrawn','version':1,'position':0}).status_code==200
        assert all(g['id']!=group for g in c.get('/api/shop/collections',headers=b).json())
        assert next(g for g in c.get('/api/shop/admin/collections',headers=a).json() if g['id']==group)['items'][0]['id']==key
    finally:
        with SessionLocal() as db:
            db.execute(delete(ShopCollectionItem).where(ShopCollectionItem.collection_id==group))
            db.execute(delete(ShopCollection).where(ShopCollection.id==group));db.commit()


def test_asset_preview_size_is_bounded_and_accepts_query_strings(store):
    from PIL import Image
    from io import BytesIO
    c,_,_=store
    for size in (128,256,512):
        r=c.get('/api/inventory/assets/cyber-oni',params={'preview':True,'preview_size':size})
        assert r.status_code==200
        with Image.open(BytesIO(r.content)) as image:assert image.size==(size,size)
    for size in (0,129,9999):
        assert c.get('/api/inventory/assets/cyber-oni',params={'preview':True,'preview_size':size}).status_code==422


def test_favorite_updates_only_owners_sessions(store, monkeypatch):
    from app.services import resource_events
    from app.services.app_events import app_event_manager
    c,users,key=store
    deliveries=[];broadcasts=[]
    async def targeted(user_id,payload):deliveries.append((str(user_id),payload))
    async def broadcast():broadcasts.append(True)
    monkeypatch.setattr(app_event_manager,'send_to_user',targeted)
    monkeypatch.setattr(resource_events,'resources_changed',broadcast)
    assert c.put('/api/shop/favorites/'+key,headers=users[1][0],json={'enabled':True}).status_code==200
    assert deliveries==[(users[1][1]['id'],{'type':'shop_favorites_changed','catalog_id':key,'favorite':True})]
    assert broadcasts==[]
