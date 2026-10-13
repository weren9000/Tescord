from io import BytesIO
from uuid import uuid4
from PIL import Image
from test_inventory import accounts, act
from test_inventory_catalog import picture, upload


def select_wallpaper(c, headers, selected, **kwargs):
    return c.put('/api/wallpapers',headers=headers,json={'selected':selected,**kwargs})


def test_basics_personal_privacy_and_validation(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,_,_=users[1];bob,_,_=users[2]
    assert c.get('/api/wallpapers').status_code==401
    data=c.get('/api/wallpapers',headers=alice).json()
    assert data['selected'] is None and len(data['presets'])==10
    for preset in data['presets']:
        image=c.get('/api/wallpapers/presets/'+preset['id'])
        assert image.status_code==200 and Image.open(BytesIO(image.content)).width>1000
    assert select_wallpaper(c,alice,'space',scale=150,dim=55).status_code==200
    data=c.get('/api/wallpapers',headers=alice).json()
    assert (data['selected'],data['scale'],data['dim'])==('space',150,55)
    assert c.get('/api/wallpapers',headers=bob).json()['selected'] is None
    assert select_wallpaper(c,alice,'unknown').status_code==400
    assert select_wallpaper(c,alice,'personal').status_code==403
    assert select_wallpaper(c,alice,'space',dim=99).status_code==422
    assert c.post('/api/wallpapers/personal',headers=alice,files={'image':('image.png',picture())}).status_code==403
    assert c.post('/api/wallpapers/personal',headers=admin,files={'image':('image.png',picture())}).status_code==403
    assert select_wallpaper(c,alice,None).json()['selected'] is None
    from uuid import UUID
    from app.db.session import SessionLocal
    from app.db.models import User
    with SessionLocal() as db:
        user=db.get(User,UUID(users[1][1]['id']))
        user.chat_wallpaper='personal'
        user.personal_wallpaper=str(uuid4())
        db.commit()
    data=c.get('/api/wallpapers',headers=alice).json()
    assert data['selected'] is None and data['personal'] is None


def test_avatar_upload_admin_only(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,_,_=users[1]
    payload={'avatar':('avatar.png',picture(),'image/png')}
    before=c.get('/api/me',headers=alice).json()
    assert c.put('/api/me/profile',headers=alice,files=payload).status_code==403
    after=c.get('/api/me',headers=alice).json()
    assert before['avatar_updated_at']==after['avatar_updated_at']
    assert c.put('/api/me/profile',headers=alice,data={'avatar_preset':'cat'}).status_code==200
    assert c.put('/api/me/profile',headers=admin,files=payload).status_code==200


def test_wallpaper_item_ownership_gift_and_revoke(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,a,_=users[1];bob,b,_=users[2]
    assert upload(c,alice,'wallpaper').status_code==403
    entry=upload(c,admin,'wallpaper').json()
    assert c.get('/api/inventory/catalog?kind=wallpaper',headers=admin).json()['total']>=1
    item=c.post('/api/inventory/grant',headers=admin,json={'catalog_id':entry['id'],'recipient_id':a['id'],'request_id':str(uuid4())}).json()['item_id']
    assert select_wallpaper(c,bob,'item:'+item).status_code==403
    assert select_wallpaper(c,alice,'item:'+item).status_code==200
    assert c.get('/api/inventory?kind=wallpaper',headers=alice).json()['items'][0]['equipped']
    assert select_wallpaper(c,alice,'space').status_code==200
    assert not c.get('/api/inventory?kind=wallpaper',headers=alice).json()['items'][0]['equipped']
    assert act(c,alice,item,'equip').status_code==200
    assert c.get('/api/wallpapers',headers=alice).json()['selected']=='item:'+item
    assert act(c,alice,item,'gift',recipient_id=b['id']).status_code==200
    assert c.get('/api/wallpapers',headers=alice).json()['selected'] is None
    assert c.get('/api/wallpapers',headers=bob).json()['selected'] is None
    assert select_wallpaper(c,alice,'item:'+item).status_code==403
    assert select_wallpaper(c,bob,'item:'+item).status_code==200
    assert act(c,admin,item,'revoke',recipient_id=b['id']).status_code==200
    assert c.get('/api/wallpapers',headers=bob).json()['selected'] is None
    assert select_wallpaper(c,bob,'item:'+item).status_code==403
