from uuid import uuid4
from test_inventory import accounts, act
from app.services.themes import THEMES


def test_theme_lifecycle_and_base_fallback(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,a,_=users[1];bob,b,_=users[2]
    assert c.get('/api/inventory/theme').status_code==401
    assert c.get('/api/inventory/theme',headers=alice).json()['id'] is None
    catalog=c.get('/api/inventory/catalog?kind=theme',headers=admin).json()
    assert {i['id'] for i in catalog['items']}==set(THEMES)
    for key in THEMES:
        asset=c.get('/api/inventory/assets/'+key)
        assert asset.status_code==200 and 'image/svg+xml' in asset.headers['content-type']
    def grant(key,recipient):
        return c.post('/api/inventory/grant',headers=admin,json={'catalog_id':key,'recipient_id':recipient['id'],'request_id':str(uuid4())}).json()['item_id']
    first=grant('theme-light',a)
    second=grant('theme-space',a)
    before=c.get('/api/me',headers=alice).json()['avatar_updated_at']
    assert c.put('/api/wallpapers',headers=alice,json={'selected':'space','scale':125,'dim':45}).status_code==200
    assert act(c,bob,first,'equip').status_code==403
    assert act(c,alice,first,'equip').status_code==200
    assert c.get('/api/inventory/theme',headers=alice).json()['scheme']=='light'
    assert c.get('/api/me',headers=alice).json()['avatar_updated_at']==before
    wallpaper=c.get('/api/wallpapers',headers=alice).json()
    assert (wallpaper['selected'],wallpaper['scale'],wallpaper['dim'])==('space',125,45)
    assert act(c,alice,second,'equip').status_code==200
    assert c.get('/api/inventory/theme',headers=alice).json()['id']=='theme-space'
    assert sum(i['equipped'] for i in c.get('/api/inventory?kind=theme',headers=alice).json()['items'])==1
    assert act(c,alice,second,'gift',recipient_id=b['id']).status_code==200
    assert c.get('/api/inventory/theme',headers=alice).json()['id'] is None
    assert c.get('/api/inventory/theme',headers=bob).json()['id'] is None
    assert act(c,bob,second,'equip').status_code==200
    assert act(c,admin,second,'revoke',recipient_id=b['id']).status_code==200
    assert c.get('/api/inventory/theme',headers=bob).json()['id'] is None
    assert act(c,alice,first,'equip').status_code==200
    assert c.post('/api/inventory/theme/reset',headers=alice,json={'request_id':str(uuid4())}).status_code==200
    assert c.get('/api/inventory/theme',headers=alice).json()['id'] is None
    assert len(c.get('/api/inventory?kind=theme',headers=alice).json()['items'])==1


def test_theme_catalog_permissions(accounts):
    c,users=accounts
    admin,_,_=users[0];alice,a,_=users[1]
    body={'catalog_id':'theme-viking','recipient_id':a['id'],'request_id':str(uuid4())}
    assert c.post('/api/inventory/grant',headers=alice,json=body).status_code==403
    assert c.post('/api/inventory/catalog',headers=admin,data={'name':'Unsafe theme','kind':'theme'},files={'image':('theme.svg',b'<svg/>')}).status_code==422
    result=c.post('/api/inventory/grant',headers=admin,json=body)
    assert result.status_code==200
    assert act(c,alice,result.json()['item_id'],'equip').status_code==200
    assert c.get('/api/inventory/theme',headers=alice).json()['id']=='theme-viking'
