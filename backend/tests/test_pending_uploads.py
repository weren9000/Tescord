from uuid import UUID, uuid4
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.db.models import PendingUpload
from app.services.pending_uploads import cleanup_expired
from test_auth_workspace import register_regular_user, delete_user, delete_server


def test_staged_uploads_order_retry_permissions_expiry_and_cleanup():
    with TestClient(app) as client:
        accounts = [register_regular_user(client) for _ in range(2)]
        headers = [{'Authorization': 'Bearer '+a[0]} for a in accounts]
        servers = []
        try:
            channels = []
            for _ in range(2):
                group = client.post('/api/conversations/group', headers=headers[0], json={'name':'Upload test', 'member_user_ids':[]})
                assert group.status_code == 201, group.text
                servers.append(group.json()['id'])
                channels.append(next(c['id'] for c in client.get(f'/api/servers/{servers[-1]}/channels',headers=headers[0]).json() if c['type']=='text'))
            route = f'/api/channels/{channels[0]}'
            ids = [str(uuid4()) for _ in range(10)]
            for i, uid in enumerate(ids):
                upload = client.put(route+'/uploads/'+uid,headers=headers[0],files={'file':(f'{i}.txt',str(i).encode(),'text/plain')})
                assert upload.status_code == 200, upload.text
            retry = client.put(route+'/uploads/'+ids[0],headers=headers[0],files={'file':('0.txt',b'0','text/plain')})
            assert retry.status_code == 200
            assert client.delete('/api/uploads/'+ids[0],headers=headers[1]).status_code == 404
            assert client.post(f'/api/channels/{channels[1]}/messages',headers=headers[0],data={'upload_ids':ids}).status_code == 404
            assert client.post(route+'/messages',headers=headers[0],data={'upload_ids':ids+[str(uuid4())]}).status_code == 413
            nonce = str(uuid4())
            payload = {'upload_ids':list(reversed(ids)), 'client_message_id':nonce,'content':'Ten files'}
            sent = client.post(route+'/messages',headers=headers[0],data=payload)
            assert sent.status_code == 201, sent.text
            message = sent.json()
            assert [a['id'] for a in message['attachments']] == list(reversed(ids))
            repeated = client.post(route+'/messages',headers=headers[0],data=payload)
            assert repeated.status_code == 201 and repeated.json()['id'] == message['id']
            assert client.delete('/api/uploads/'+ids[0],headers=headers[0]).status_code == 409
            assert client.post(route+'/messages',headers=headers[0],data={'upload_ids':ids}).status_code == 409
            for i, uid in enumerate(ids):
                assert client.get('/api/attachments/'+uid,headers=headers[0]).content == str(i).encode()
            orphan = str(uuid4())
            assert client.put(route+'/uploads/'+orphan,headers=headers[0],files={'file':('orphan.txt',b'pending')}).status_code == 200
            with SessionLocal() as db:
                for uid in ids+[orphan]:
                    db.get(PendingUpload,UUID(uid)).expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
                db.commit()
            assert client.post(route+'/messages',headers=headers[0],data={'upload_ids':[orphan]}).status_code == 410
            cleanup_expired()
            with SessionLocal() as db:
                assert db.get(PendingUpload,UUID(orphan)) is None
            assert client.get('/api/attachments/'+ids[0],headers=headers[0]).content == b'0'
            assert client.post(route+'/messages',headers=headers[0],data=payload).json()['id'] == message['id']
        finally:
            for sid in servers: delete_server(sid)
            for _, account in accounts: delete_user(account['email'])
