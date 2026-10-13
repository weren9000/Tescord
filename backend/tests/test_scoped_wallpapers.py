from uuid import UUID, uuid4
import pytest
from test_inventory import accounts, act
from app.db.models import Server, User, ServerKind
from app.db.session import SessionLocal
from app.services.direct_conversations import ensure_direct_conversation


@pytest.fixture
def chats(accounts):
    client, users = accounts
    alice, a, _ = users[1]
    _, b, _ = users[2]
    group = client.post('/api/conversations/group', headers=alice, json={'name':'Wallpaper review','member_ids':[b['id']]}).json()['id']
    platform = client.post('/api/conversations/group', headers=alice, json={'name':'Wallpaper platform','member_ids':[b['id']]}).json()['id']
    with SessionLocal() as db:
        db.get(Server, UUID(platform)).kind = ServerKind.WORKSPACE
        direct, _ = ensure_direct_conversation(db, db.get(User, UUID(a['id'])), db.get(User, UUID(b['id'])))
        direct_id = str(direct.id)
        db.commit()
    try:
        yield client, users, [group, platform, direct_id]
    finally:
        with SessionLocal() as db:
            for key in [group, platform, direct_id]:
                db.delete(db.get(Server, UUID(key)))
            db.commit()


def test_shared_defaults_private_override_and_permissions(chats):
    client, users, ids = chats
    outsider, _, _ = users[0]; alice, _, _ = users[1]; bob, _, _ = users[2]
    for i, key in enumerate(ids[:2]):
        path = '/api/wallpapers/chats/' + key
        assert client.get(path).status_code == 401
        assert client.get(path, headers=outsider).status_code == 404
        assert client.put(path, headers=outsider, json={'selected':'forest'}).status_code == 404
        assert client.put(path, headers=bob, json={'target':'shared','selected':'forest'}).status_code == 403
        chosen = ['forest','space'][i]
        assert client.put(path, headers=alice, json={'target':'shared','selected':chosen,'scale':135,'dim':20}).status_code == 200
        state = client.get(path, headers=bob).json()['context']
        assert state['source']=='owner' and state['effective']['selected']==chosen
        assert state['effective']['scale']==135 and state['effective']['dim']==20
        assert state['can_manage'] is False
        assert client.put(path, headers=bob, json={'selected':None}).status_code == 200
        state = client.get(path, headers=bob).json()['context']
        assert state['source']=='personal' and state['effective']['asset'] is None
        assert client.get(path, headers=alice).json()['context']['effective']['selected']==chosen
        client.put(path, headers=alice, json={'target':'shared','selected':'magic'})
        assert client.get(path, headers=bob).json()['context']['effective']['asset'] is None
        client.put(path, headers=bob, json={'inherit':True})
        assert client.get(path, headers=bob).json()['context']['effective']['selected']=='magic'
    # Settings are independent for each group/platform.
    client.put('/api/wallpapers/chats/'+ids[0], headers=alice, json={'target':'shared','selected':'forest'})
    assert client.get('/api/wallpapers/chats/'+ids[1], headers=bob).json()['context']['effective']['selected']=='magic'


def test_direct_uses_peer_profile_not_viewer_profile(chats):
    client, users, ids = chats
    alice, _, _ = users[1]; bob, _, _ = users[2]
    client.put('/api/wallpapers', headers=alice, json={'selected':'space'})
    client.put('/api/wallpapers', headers=bob, json={'selected':'forest'})
    path = '/api/wallpapers/chats/'+ids[2]
    assert client.get(path, headers=alice).json()['context']['effective']['selected']=='forest'
    assert client.get(path, headers=bob).json()['context']['effective']['selected']=='space'
    assert client.put(path, headers=alice, json={'target':'shared','selected':'magic'}).status_code==403
    client.put(path, headers=alice, json={'selected':'pirates'})
    client.put('/api/wallpapers', headers=bob, json={'selected':'games'})
    assert client.get(path, headers=alice).json()['context']['effective']['selected']=='pirates'
    client.put(path, headers=alice, json={'inherit':True})
    assert client.get(path, headers=alice).json()['context']['effective']['selected']=='games'


@pytest.mark.parametrize('action', ['gift','revoke'])
def test_item_visibility_ownership_and_cleanup(chats, action):
    client, users, ids = chats
    admin, _, _ = users[0]; alice, a, _ = users[1]; bob, b, _ = users[2]
    result = client.post('/api/inventory/grant', headers=admin, json={'catalog_id':'wallpaper-mint-animals','recipient_id':a['id'],'request_id':str(uuid4())})
    item = result.json()['item_id']; selection='item:'+item
    group='/api/wallpapers/chats/'+ids[0]; direct='/api/wallpapers/chats/'+ids[2]
    assert client.put(group, headers=bob, json={'selected':selection}).status_code==403
    assert client.put(group, headers=alice, json={'target':'shared','selected':selection}).status_code==200
    assert client.put(direct, headers=alice, json={'selected':selection}).status_code==200
    assert client.put('/api/wallpapers', headers=alice, json={'selected':selection}).status_code==200
    assert client.get(group, headers=bob).json()['context']['effective']['asset']=='/api/inventory/assets/wallpaper-mint-animals'
    assert client.get(direct, headers=bob).json()['context']['effective']['asset']=='/api/inventory/assets/wallpaper-mint-animals'
    actor=alice if action=='gift' else admin
    recipient=b['id'] if action=='gift' else a['id']
    assert act(client,actor,item,action,recipient_id=recipient).status_code==200
    assert client.get(group, headers=bob).json()['context']['effective']['asset'] is None
    assert client.get(direct, headers=bob).json()['context']['effective']['asset'] is None
    assert client.get(direct, headers=alice).json()['context']['override'] is None
    if action=='gift':
        assert act(client,bob,item,'gift',recipient_id=a['id']).status_code==200
        assert client.get(group,headers=alice).json()['context']['effective']['asset'] is None
