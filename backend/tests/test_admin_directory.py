from uuid import UUID, uuid4
from io import BytesIO
from PIL import Image

from app.db.models import Channel, ChannelType, MemberRole, Server, ServerKind, ServerMember, User
from app.db.session import SessionLocal
from test_inventory import accounts


def test_directory_access_pagination_and_private_data(accounts):
    client, people = accounts
    admin, profile, _ = people[0]
    ordinary, user, _ = people[1]
    root = '/api/admin/directory'
    assert client.get(root+'/users').status_code == 401
    # Avatar administration must not grant access to the system directory.
    assert client.get(root+'/users', headers=admin).status_code == 403
    with SessionLocal() as db:
        db.get(User, UUID(profile['id'])).is_admin = True
        db.commit()
    for path in ['/counts', '/users', '/users/'+profile['id'], '/users/'+profile['id']+'/spaces',
                 '/spaces/groups', '/spaces/platforms', '/spaces/groups/'+str(uuid4()),
                 '/spaces/groups/'+str(uuid4())+'/members', '/spaces/groups/'+str(uuid4())+'/channels']:
        assert client.get(root+path, headers=ordinary).status_code == 403
    response = client.get(root+'/users', headers=admin, params={'q':user['email'], 'size':24})
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['total'] == 1
    item = response.json()['items'][0]
    assert item['id'] == user['id'] and 'email' not in item and 'password_hash' not in item
    detail = client.get(root+'/users/'+user['id'], headers=admin).json()
    assert detail['email'] == user['email'] and 'password_hash' not in detail
    assert client.get(root+'/users', headers=admin, params={'q':user['email'], 'role':'admin'}).json()['total'] == 0
    assert client.get(root+'/users', headers=admin, params={'q':str(user['public_id'])}).json()['items'][0]['id'] == user['id']
    assert client.get(root+'/users', headers=admin, params={'q':'%'}).json()['total'] == 0
    assert client.get(root+'/users', headers=admin, params={'page':0}).status_code == 422
    assert client.get(root+'/users/'+str(uuid4()), headers=admin).status_code == 404


def test_directory_spaces_relations_and_stable_pages(accounts):
    client, people = accounts
    admin, profile, _ = people[0]
    _, user, _ = people[1]
    owner = UUID(user['id'])
    prefix = 'dir-'+uuid4().hex[:8]
    ids=[]
    with SessionLocal() as db:
        db.get(User, UUID(profile['id'])).is_admin = True
        for i in range(27):
            kind=ServerKind.GROUP_CHAT if i<25 else ServerKind.WORKSPACE if i==25 else ServerKind.DIRECT
            space=Server(id=uuid4(), name=f'{prefix}-{i:02}', slug=f'{prefix}-{i:02}', kind=kind, owner_id=owner)
            db.add(space);db.flush();ids.append(str(space.id))
            db.add(ServerMember(server_id=space.id,user_id=owner,role=MemberRole.OWNER))
            db.add(Channel(server_id=space.id,created_by_id=owner,name='Channel',type=ChannelType.TEXT))
        db.commit()
    root='/api/admin/directory'
    a=client.get(root+'/spaces/groups',headers=admin,params={'q':prefix,'size':24,'sort':'name'}).json()
    b=client.get(root+'/spaces/groups',headers=admin,params={'q':prefix,'page':2,'size':24,'sort':'name'}).json()
    assert a['total']==25 and len(a['items'])==24 and len(b['items'])==1
    assert not {x['id'] for x in a['items']} & {x['id'] for x in b['items']}
    assert a['items'][0]['members_count']==1 and a['items'][0]['channels_count']==1
    assert client.get(root+'/spaces/platforms',headers=admin,params={'q':prefix}).json()['total']==1
    assert client.get(root+'/spaces/groups/'+ids[26],headers=admin).status_code==404
    assert client.get(root+'/spaces/platforms/'+ids[0],headers=admin).status_code==404
    assert client.get(root+'/spaces/groups',headers=admin,params={'q':prefix,'owner':str(user['public_id'])}).json()['total']==25
    detail=client.get(root+'/spaces/groups/'+ids[0]+'/members',headers=admin).json()
    assert detail['items'][0]['id']==user['id'] and detail['items'][0]['role']=='owner'
    assert client.get(root+'/spaces/groups/'+ids[0]+'/channels',headers=admin).json()['items'][0]['type']=='text'
    related=client.get(root+'/users/'+user['id']+'/spaces',headers=admin).json()
    assert ids[26] not in {x['id'] for x in related['items']}
    assert client.get(root+'/spaces/groups',headers=admin,params={'q':prefix,'page':999}).json()['page']==2
    # Sort the full result before pagination; combine column filters with AND.
    filtered=client.get(root+'/spaces/groups',headers=admin,params={'name':prefix,'owner':str(user['public_id']),'members_min':1,'members_max':1,'channels_min':1,'sort_by':'name','direction':'desc','size':1}).json()
    assert filtered['total']==25 and filtered['items'][0]['name']==prefix+'-24'
    assert client.get(root+'/spaces/groups',headers=admin,params={'name':prefix,'members_min':2}).json()['total']==0
    assert client.get(root+'/spaces/groups',headers=admin,params={'members_min':2,'members_max':1}).status_code==422
    assert client.get(root+'/spaces/groups',headers=admin,params={'created_from':'2026-02-02','created_to':'2026-01-01'}).status_code==422
    assert client.get(root+'/spaces/groups',headers=admin,params={'sort_by':'email'}).status_code==422
    filtered=client.get(root+'/users',headers=admin,params={'public_id':user['public_id'],'role':'regular','sort_by':'public_id','direction':'desc'}).json()
    assert filtered['total']==1 and filtered['items'][0]['id']==user['id']
    assert client.get(root+'/users',headers=admin,params={'public_id':user['public_id'],'role':'admin'}).json()['total']==0
    assert client.get(root+'/users',headers=admin,params={'public_id':user['public_id'],'created_to':'2000-01-01'}).json()['total']==0
    assert client.get(root+'/users',headers=admin,params={'name':'%'}).json()['total']==0


def test_directory_thumbnails_keep_originals(accounts):
    client, people = accounts
    _, user, _ = people[1]
    source=BytesIO();Image.new('RGBA',(300,300),(20,100,200,200)).save(source,'PNG')
    content=source.getvalue()
    with SessionLocal() as db:
        u=db.get(User,UUID(user['id']));u.avatar_content=content;u.avatar_mime_type='image/png'
        space=Server(id=uuid4(),name='Preview',slug=uuid4().hex,owner_id=u.id,kind=ServerKind.GROUP_CHAT,
                     icon_content=content,icon_mime_type='image/png')
        db.add(space);db.commit();key=str(space.id)
    for path in ['/api/users/'+user['id']+'/avatar','/api/servers/'+key+'/icon-file']:
        original=client.get(path);assert original.status_code==200 and original.content==content
        thumb=client.get(path+'?preview=true');assert thumb.status_code==200
        assert thumb.headers['content-type']=='image/webp'
        assert Image.open(BytesIO(thumb.content)).size==(96,96)
        assert client.get(path+'?preview=true').content==thumb.content
        assert client.get(path).content==content
