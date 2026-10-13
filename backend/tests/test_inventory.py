from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4, UUID
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, delete
from app.main import app
from app.db.models import User
from app.db.inventory import InventoryItem, InventoryEvent
from app.db.session import SessionLocal
from test_auth_workspace import register_regular_user, delete_user


@pytest.fixture
def accounts():
    with TestClient(app) as client:
        users=[]
        for _ in range(3):
            token, form=register_regular_user(client)
            headers={'Authorization':'Bearer '+token}
            user=client.get('/api/me',headers=headers).json()
            users.append((headers,user,form))
        with SessionLocal() as db:
            db.get(User,UUID(users[0][1]['id'])).is_avatar_admin=True
            db.commit()
        try: yield client,users
        finally:
            ids=[UUID(u[1]['id']) for u in users]
            with SessionLocal() as db:
                items=select(InventoryItem.id).where(InventoryItem.owner_id.in_(ids))
                db.execute(delete(InventoryEvent).where(InventoryEvent.item_id.in_(items)))
                db.execute(delete(InventoryItem).where(InventoryItem.owner_id.in_(ids)))
                db.commit()
            for _,_,form in users: delete_user(form['email'])


def grant(client,admin,recipient,request_id=None):
    body={'catalog_id':'cyber-oni','recipient_id':recipient['id'],'request_id':request_id or str(uuid4())}
    r=client.post('/api/inventory/grant',headers=admin,json=body)
    assert r.status_code==200,r.text
    return r.json()['item_id'],body


def act(client,headers,item,action,**kw):
    return client.post(f'/api/inventory/items/{item}/{action}',headers=headers,json={'request_id':str(uuid4()),**kw})


def test_grant_equip_gift_revoke_and_history(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,a,_=users[1];bob,b,_=users[2]
    item,body=grant(c,admin,a)
    assert c.post('/api/inventory/grant',headers=admin,json=body).json()['item_id']==item
    assert len(c.get('/api/inventory',headers=alice).json()['items'])==1
    assert act(c,bob,item,'equip').status_code==403
    assert act(c,bob,item,'gift',recipient_id=b['id']).status_code==403
    assert act(c,alice,item,'equip').status_code==200
    image=c.get('/api/inventory/assets/cyber-oni').content
    assert c.get('/api/users/'+a['id']+'/avatar').content==image
    second,_=grant(c,admin,a)
    assert act(c,alice,second,'equip').status_code==200
    assert sum(i['equipped'] for i in c.get('/api/inventory',headers=alice).json()['items'])==1
    assert act(c,alice,second,'gift',recipient_id=b['id']).status_code==200
    assert c.get('/api/users/'+a['id']+'/avatar').content!=image
    assert act(c,alice,second,'equip').status_code==403
    data=c.get('/api/inventory',headers=bob).json()
    assert data['items'][0]['id']==second and data['unread']==1
    assert not data['items'][0]['equipped']
    assert act(c,bob,second,'equip').status_code==200
    assert act(c,admin,second,'revoke',recipient_id=a['id']).status_code==409
    assert act(c,admin,second,'revoke',recipient_id=b['id']).status_code==200
    assert c.get('/api/inventory',headers=bob).json()['items']==[]
    assert c.get('/api/users/'+b['id']+'/avatar').content!=image
    history=c.get(f'/api/inventory/items/{second}/history',headers=admin).json()
    assert {e['action'] for e in history}=={'grant','equip','gift','revoke'}
    assert c.get(f'/api/inventory/items/{second}/history',headers=alice).status_code==404
    c.post('/api/inventory/read',headers=bob)
    assert c.get('/api/inventory',headers=bob).json()['unread']==0


def test_permissions_and_ordinary_avatar(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,a,_=users[1]
    assert c.get('/api/inventory').status_code==401
    for path in ['catalog','issued']:
        assert c.get('/api/inventory/'+path,headers=alice).status_code==403
    assert c.post('/api/inventory/grant',headers=alice,json={'catalog_id':'cyber-oni','recipient_id':a['id'],'request_id':str(uuid4())}).status_code==403
    item,_=grant(c,admin,a)
    assert act(c,alice,item,'gift',recipient_id=a['id']).status_code==400
    assert act(c,alice,item,'revoke',recipient_id=a['id']).status_code==403
    assert act(c,alice,item,'equip').status_code==200
    assert c.put('/api/me/profile',headers=alice,data={'avatar_preset':'cyber-oni'}).status_code==400
    assert c.put('/api/me/profile',headers=alice,data={'avatar_preset':'cat'}).status_code==200
    assert not c.get('/api/inventory',headers=alice).json()['items'][0]['equipped']
    assert c.get('/api/users/'+a['id']+'/avatar').content==c.get('/api/avatar-presets/cat').content


def test_parallel_gifts_and_retry_do_not_duplicate(accounts):
    c,users=accounts
    admin,ad,_=users[0];alice,a,_=users[1];bob,b,_=users[2]
    item,_=grant(c,admin,a)
    def send(recipient):
        return act(c,alice,item,'gift',recipient_id=recipient).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(send,[ad['id'],b['id']]))
    assert sorted(results)==[200,403]
    owned=[i for h,_,_ in users for i in c.get('/api/inventory',headers=h).json()['items'] if i['id']==item]
    assert len(owned)==1
    second,_=grant(c,admin,a)
    request={'request_id':str(uuid4()),'recipient_id':b['id']}
    for _ in range(2):assert c.post(f'/api/inventory/items/{second}/gift',headers=alice,json=request).status_code==200
    history=c.get(f'/api/inventory/items/{second}/history',headers=admin).json()
    assert [e['action'] for e in history].count('gift')==1
