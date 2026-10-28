from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import UUID
from PIL import Image
from sqlalchemy import select
from app.db.models import PlatformFriendInvite, PlatformMember
from app.db.inventory import InventoryItem
from app.db.session import SessionLocal
from test_platforms import community, join_member
from test_auth_workspace import make_friends


def test_icon_upload_inventory_permissions_and_reset(community):
    client,h,ids,p=community
    endpoint=f"/api/platforms/{p['id']}/icon"
    join_member(client,h,p['id'],1)
    data=BytesIO();Image.new('RGB',(320,240),'red').save(data,format='PNG')
    files={'icon':('icon.png',data.getvalue(),'image/png')}
    assert client.put(endpoint,headers=h[1],files=files).status_code==403
    assert client.put(endpoint,headers=h[0],files={'icon':('bad.png',b'invalid','image/png')}).status_code==400
    result=client.put(endpoint,headers=h[0],files=files,data={'crop_x':.2,'crop_y':.8,'zoom':2})
    assert result.status_code==200,result.text
    assert result.json()['icon_url'].startswith(endpoint)
    content=client.get(endpoint)
    assert content.status_code==200
    assert Image.open(BytesIO(content.content)).size==(512,512)
    assert client.put(endpoint,headers=h[0],files=files,data={'zoom':0}).status_code==422
    with SessionLocal() as db:
        item=InventoryItem(owner_id=UUID(ids[0]),catalog_id='shark',kind='avatar')
        db.add(item);db.commit()
        item_id=str(item.id);catalog=item.catalog_id
    selected=client.patch(endpoint,headers=h[0],json={'item_id':item_id})
    assert selected.status_code==200,selected.text
    assert catalog in selected.json()['icon_url']
    assert client.get(endpoint).status_code==404
    assert client.patch(endpoint,headers=h[1],json={'item_id':item_id}).status_code==403
    assert client.delete(endpoint,headers=h[0]).status_code==204
    assert next(x for x in client.get('/api/platforms',headers=h[0]).json() if x['id']==p['id'])['icon_url'] is None


def test_link_duration_and_limit_options(community):
    client,h,ids,p=community
    endpoint=f"/api/platforms/{p['id']}/invites"
    for hours in [1,24,168,None]:
        result=client.post(endpoint,headers=h[0],json={'expires_in_hours':hours,'max_uses':5})
        assert result.status_code==201,result.text
        expiry=result.json()['expires_at']
        if hours is None:assert expiry is None
        else:assert abs((datetime.fromisoformat(expiry)-datetime.now(timezone.utc)).total_seconds()-hours*3600)<10
    assert client.post(endpoint,headers=h[0],json={'expires_in_hours':2}).status_code==422
    assert client.post(endpoint,headers=h[0],json={'max_uses':0}).status_code==422
    old=client.post(endpoint,headers=h[0],json={'expires_in_days':7}).json()
    assert (datetime.fromisoformat(old['expires_at'])-datetime.now(timezone.utc)).days==6


def test_friends_batch_duplicates_accept_reject_and_access(community):
    client,h,ids,p=community
    for i in [1,2]:make_friends(client,h[0]['Authorization'][7:],h[i]['Authorization'][7:])
    endpoint=f"/api/platforms/{p['id']}/friend-invites"
    assert client.get(endpoint,headers=h[1]).status_code==404
    assert client.post(endpoint,headers=h[0],json={'user_ids':[ids[3]]}).status_code==403
    assert len(client.get(endpoint,headers=h[0]).json())==2
    assert client.post(endpoint,headers=h[0],json={'user_ids':[ids[1],ids[2]]}).json()['sent']==2
    assert client.post(endpoint,headers=h[0],json={'user_ids':[ids[1]]}).json()['sent']==0
    row=client.get('/api/friend-space-invites',headers=h[1]).json()[0]
    assert row['kind']=='platform' and row['name']=='Community'
    route=f"/api/friend-space-invites/{row['id']}"
    assert client.post(route+'/accept',headers=h[2]).status_code==404
    result=client.post(route+'/accept',headers=h[1])
    assert result.status_code==200,result.text
    assert result.json()['platform_id']==p['id']
    assert client.get(f"/api/servers/{p['chat_id']}/channels",headers=h[1]).status_code==200
    assert client.post(route+'/accept',headers=h[1]).status_code==410
    assert client.post(endpoint,headers=h[1],json={'user_ids':[ids[2]]}).status_code==403
    row=client.get('/api/friend-space-invites',headers=h[2]).json()[0]
    assert client.post(f"/api/friend-space-invites/{row['id']}/reject",headers=h[2]).status_code==200
    assert client.post(endpoint,headers=h[0],json={'user_ids':[ids[2]]}).json()['sent']==0
    with SessionLocal() as db:
        assert db.scalar(select(PlatformMember).where(PlatformMember.platform_id==UUID(p['id']),PlatformMember.user_id==UUID(ids[2]))) is None
        invite=db.get(PlatformFriendInvite,UUID(row['id']));invite.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1);db.commit()
    assert client.post(endpoint,headers=h[0],json={'user_ids':[ids[2]]}).json()['sent']==1
    with SessionLocal() as db:
        invite=db.get(PlatformFriendInvite,UUID(row['id']));invite.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1);db.commit()
    assert client.post(f"/api/friend-space-invites/{row['id']}/accept",headers=h[2]).status_code==410
