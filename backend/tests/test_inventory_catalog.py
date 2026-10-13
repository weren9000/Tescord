from io import BytesIO
from uuid import UUID, uuid4
from PIL import Image, ImageDraw
from sqlalchemy import select
from test_inventory import accounts, act
from app.db.inventory import InventoryCatalog
from app.db.session import SessionLocal
from app.services.inventory import CATALOG


def picture(frame=False):
    im=Image.new('RGBA',(256,256),(20,80,180,0 if frame else 255))
    if frame: ImageDraw.Draw(im).rectangle((8,8,247,247),outline=(20,200,220,255),width=12)
    out=BytesIO();im.save(out,format='PNG');return out.getvalue()


def upload(c,headers,kind='avatar',data=None):
    return c.post('/api/inventory/catalog',headers=headers,data={'name':'New item','kind':kind},
                  files={'image':('item.png',data if data is not None else picture(kind=='frame'),'image/png')})


def test_upload_permissions_validation_and_lifecycle(accounts):
    c,users=accounts
    admin,ad,_=users[0];alice,a,_=users[1];bob,b,_=users[2]
    assert upload(c,alice).status_code==403
    assert upload(c,admin,data=b'<svg/>').status_code==400
    assert upload(c,admin,data=b'x'*(10*1024*1024+1)).status_code==413
    tiny=BytesIO();Image.new('RGB',(64,64)).save(tiny,format='PNG')
    assert upload(c,admin,data=tiny.getvalue()).status_code==400
    assert upload(c,admin,kind='frame',data=picture()).status_code==400
    r=upload(c,admin);assert r.status_code==200,r.text
    entry=r.json();key=entry['id']
    asset=c.get('/api/inventory/assets/'+key);assert asset.status_code==200
    assert Image.open(BytesIO(asset.content)).size==(512,512)
    r=c.post('/api/inventory/grant',headers=admin,json={'catalog_id':key,'recipient_id':a['id'],'request_id':str(uuid4())})
    assert r.status_code==200
    item=r.json()['item_id']
    assert act(c,alice,item,'equip').status_code==200
    assert c.get('/api/users/'+a['id']+'/avatar').content==asset.content
    assert c.patch('/api/inventory/catalog/'+key,headers=alice,json={'hidden':True}).status_code==403
    assert c.patch('/api/inventory/catalog/'+key,headers=admin,json={'name':'Renamed','hidden':True}).status_code==200
    assert c.post('/api/inventory/grant',headers=admin,json={'catalog_id':key,'recipient_id':b['id'],'request_id':str(uuid4())}).status_code==404
    assert c.get('/api/inventory',headers=alice).json()['items'][0]['name']=='Renamed'
    assert act(c,alice,item,'gift',recipient_id=b['id']).status_code==200
    assert act(c,bob,item,'equip').status_code==200
    assert c.get('/api/users/'+b['id']+'/avatar').content==asset.content
    frame=upload(c,admin,'frame').json()
    r=c.post('/api/inventory/grant',headers=admin,json={'catalog_id':frame['id'],'recipient_id':b['id'],'request_id':str(uuid4())})
    assert act(c,bob,r.json()['item_id'],'equip').status_code==200
    avatar=c.get('/api/users/'+b['id']+'/avatar')
    assert avatar.status_code==200 and avatar.headers['content-type'].startswith('image/svg+xml')


def test_pagination_search_and_equipment_across_pages(accounts):
    c,users=accounts
    admin,ad,_=users[0];alice,a,_=users[1]
    with SessionLocal() as db:
        assert all(db.get(InventoryCatalog,key) is not None for key in CATALOG)
        for i in range(23):
            db.add(InventoryCatalog(id=str(uuid4()),name=f'Page fixture {i:02}',kind='avatar',builtin=False,hidden=False,created_by=UUID(ad['id'])))
        db.commit()
    first=c.get('/api/inventory/catalog?kind=avatar&q=Page%20fixture',headers=admin).json()
    second=c.get('/api/inventory/catalog?kind=avatar&q=Page%20fixture&page=2',headers=admin).json()
    assert first['total']==23 and len(first['items'])==20 and len(second['items'])==3
    assert not ({i['id'] for i in first['items']} & {i['id'] for i in second['items']})
    assert c.get('/api/inventory/catalog?kind=frame&q=Page%20fixture',headers=admin).json()['total']==0
    items=[]
    for _ in range(21):
        r=c.post('/api/inventory/grant',headers=admin,json={'catalog_id':'shark','recipient_id':a['id'],'request_id':str(uuid4())})
        items.append(r.json()['item_id'])
    assert act(c,alice,items[0],'equip').status_code==200
    first=c.get('/api/inventory?kind=avatar',headers=alice).json()
    second=c.get('/api/inventory?kind=avatar&page=2',headers=alice).json()
    assert first['total']==21 and len(first['items'])==20 and len(second['items'])==1
    assert first['equipped_ids']==[items[0]]==second['equipped_ids']
    issued=c.get('/api/inventory/issued',params={'q':a['nick'],'kind':'avatar'},headers=admin).json()
    assert issued['total']==21
    assert c.get('/api/inventory?page=999',headers=alice).json()['page']==2


def test_crop_matches_selected_edge():
    from app.services.collectible_uploads import prepare_image
    im=Image.new('RGB',(512,256),'red')
    ImageDraw.Draw(im).rectangle((256,0,511,255),fill='blue')
    out=BytesIO();im.save(out,format='PNG')
    left=Image.open(BytesIO(prepare_image(out.getvalue(),'avatar',0,0,1)))
    right=Image.open(BytesIO(prepare_image(out.getvalue(),'avatar',1,0,1)))
    assert left.getpixel((256,256))[0]>240
    assert right.getpixel((256,256))[2]>240
