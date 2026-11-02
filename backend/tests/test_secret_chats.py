import base64
import json
from uuid import UUID, uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.core.config import get_settings
from app.api.routes.secret_chats import canonical, matrix_user
from app.db.session import SessionLocal
from app.db.secret_chats import SecretEnvelope
from test_auth_workspace import register_regular_user, delete_user, get_current_user_profile


def encode(value):
    return base64.b64encode(value).decode().rstrip('=')


def device_payload(user_id, device_id, signing=None):
    signing = signing or Ed25519PrivateKey.generate()
    identity = matrix_user(user_id)
    def signed(value):
        return {**value,'signatures':{identity:{'ed25519:'+device_id:encode(signing.sign(canonical(value)))}}}
    keys = signed({'user_id':identity, 'device_id':device_id,
        'algorithms':['m.olm.v1.curve25519-aes-sha2','m.megolm.v1.aes-sha2'],
        'keys':{'ed25519:'+device_id:encode(signing.public_key().public_bytes_raw()),
                'curve25519:'+device_id:encode(X25519PrivateKey.generate().public_key().public_bytes_raw())}})
    return {'name':'Test device', 'device_keys':keys,
            'one_time_keys':{'signed_curve25519:one':signed({'key':encode(X25519PrivateKey.generate().public_key().public_bytes_raw())})}}


def test_device_bound_transport_key_validation_and_replay(monkeypatch):
    monkeypatch.setattr(get_settings(),'secret_chats_enabled',True)
    with TestClient(app) as client:
        accounts = [register_regular_user(client) for _ in range(3)]
        headers = [{'Authorization':'Bearer '+a[0]} for a in accounts]
        users = [get_current_user_profile(client,a[0])['id'] for a in accounts]
        ids = [str(uuid4()) for _ in accounts]
        signing = [Ed25519PrivateKey.generate() for _ in accounts]
        payloads = [device_payload(u,d,s) for u,d,s in zip(users,ids,signing)]
        try:
            for index in range(3):
                response = client.put('/api/secret/devices/'+ids[index]+'/keys', headers=headers[index], json=payloads[index])
                assert response.status_code == 200, response.text
                headers[index]['X-Secret-Device'] = ids[index]
            # Signed keys cannot be silently replaced, even by the owning account.
            replacement = device_payload(users[0],ids[0])
            assert client.put('/api/secret/devices/'+ids[0]+'/keys',headers=headers[0],json=replacement).status_code == 409
            assert client.get('/api/secret/devices',headers=headers[0],params={'user_id':users[1]}).status_code == 404
            request = client.post('/api/friends/requests',headers=headers[0],json={'user_id':users[1]}).json()
            assert client.post('/api/friends/requests/'+request['id']+'/accept',headers=headers[1],json={}).status_code == 200
            response = client.post('/api/secret/chats',headers=headers[0],json={'peer_device_id':ids[1]})
            assert response.status_code == 201, response.text
            chat = response.json()['id']
            assert client.post('/api/secret/chats/'+chat+'/keys/claim',headers=headers[0]).status_code == 409
            assert client.post('/api/secret/chats/'+chat+'/accept',headers=headers[0]).status_code == 403
            assert client.post('/api/secret/chats/'+chat+'/accept',headers=headers[1]).status_code == 200
            assert client.get('/api/secret/chats/'+chat+'/envelopes',headers=headers[2]).status_code == 404
            assert client.get('/api/secret/chats',headers={**headers[2],'X-Secret-Device':ids[0]}).status_code == 403
            claim = client.post('/api/secret/chats/'+chat+'/keys/claim',headers=headers[0])
            assert claim.status_code == 200 and claim.json()['one_time_keys']
            assert client.post('/api/secret/chats/'+chat+'/keys/claim',headers=headers[0]).json()['one_time_keys'] == {}
            # Retrying key upload never makes a previously claimed key reusable.
            assert client.put('/api/secret/devices/'+ids[1]+'/keys',headers=headers[1],json=payloads[1]).json()['one_time_key_counts']['signed_curve25519'] == 0
            plain = {'client_id':str(uuid4()),'kind':'message','ciphertext':{'content':'must not reach storage'}}
            assert client.post('/api/secret/chats/'+chat+'/envelopes',headers=headers[0],json=plain).status_code == 422
            encrypted = {'client_id':str(uuid4()),'kind':'message','ciphertext':{'algorithm':'m.megolm.v1.aes-sha2',
                'sender_key':payloads[0]['device_keys']['keys']['curve25519:'+ids[0]],'device_id':ids[0],
                'session_id':encode(bytes(32)),'ciphertext':encode(b'synthetic ciphertext')}}
            first = client.post('/api/secret/chats/'+chat+'/envelopes',headers=headers[0],json=encrypted)
            assert first.status_code == 201, first.text
            assert client.post('/api/secret/chats/'+chat+'/envelopes',headers=headers[0],json=encrypted).json() == first.json()
            received = client.get('/api/secret/chats/'+chat+'/envelopes',headers=headers[1]).json()
            assert len(received) == 1 and received[0]['ciphertext'] == encrypted['ciphertext']
            seq = received[0]['sequence']
            # The sender cannot acknowledge/erase the recipient's delivery.
            client.post('/api/secret/chats/'+chat+'/ack',headers=headers[0],json={'sequences':[seq]})
            assert client.get('/api/secret/chats/'+chat+'/envelopes',headers=headers[1]).json()
            assert client.post('/api/secret/chats/'+chat+'/ack',headers=headers[1],json={'sequences':[seq]}).status_code == 200
            assert client.get('/api/secret/chats/'+chat+'/envelopes',headers=headers[1]).json() == []
            assert client.post('/api/secret/chats/'+chat+'/envelopes',headers=headers[0],json=encrypted).json() == first.json()
            with SessionLocal() as db:
                assert db.get(SecretEnvelope,seq).ciphertext == {}
            altered = json.loads(json.dumps(encrypted));altered['ciphertext']['ciphertext'] = encode(b'altered')
            assert client.post('/api/secret/chats/'+chat+'/envelopes',headers=headers[0],json=altered).status_code == 409
            # Opaque file chunks are private to the fixed pair; metadata never
            # carries a filename/key, and retry cannot overwrite ciphertext.
            upload_id = str(uuid4())
            data = b'opaque test ciphertext with tag'
            response = client.post(f'/api/secret/chats/{chat}/uploads',headers=headers[0],json={'id':upload_id,'size_bytes':len(data),'chunk_count':1})
            assert response.status_code == 201, response.text
            assert client.post(f'/api/secret/uploads/{upload_id}/complete',headers=headers[0]).status_code == 409
            binary_headers = {**headers[0],'Content-Type':'application/octet-stream'}
            url = f'/api/secret/uploads/{upload_id}/chunks/0'
            assert client.put(url,headers=binary_headers,content=data[:-1]).status_code == 422
            assert client.put(url,headers=binary_headers,content=data).status_code == 200
            assert client.put(url,headers=binary_headers,content=data).status_code == 200
            assert client.put(url,headers=binary_headers,content=b'x'*len(data)).status_code == 409
            assert client.get(url,headers=headers[1]).status_code == 409
            assert client.get(url,headers=headers[2]).status_code == 404
            assert client.post(f'/api/secret/uploads/{upload_id}/complete',headers=headers[0]).status_code == 200
            assert client.get(url,headers=headers[1]).content == data
            assert client.get(url,headers=headers[1]).headers['cache-control'] == 'no-store'
            with_file = {**encrypted,'client_id':str(uuid4()),'upload_ids':[upload_id]}
            assert client.post(f'/api/secret/chats/{chat}/envelopes',headers=headers[0],json=with_file).status_code == 201
            from app.services.secret_cleanup import cleanup_secret_data
            from app.db.secret_chats import SecretUpload
            from app.api.routes.secret_chats import chunk_path
            cleanup_secret_data()
            assert chunk_path(upload_id,0).read_bytes() == data
            # A new account session alone cannot impersonate this device.
            session = client.post('/api/auth/login',json={'email':accounts[1][1]['email'],'password':accounts[1][1]['password']}).json()
            renewed = {'Authorization':'Bearer '+session['access_token'],'X-Secret-Device':ids[1]}
            assert client.get('/api/secret/chats',headers=renewed).status_code == 403
            challenge = client.post('/api/secret/devices/'+ids[1]+'/session-challenge',headers=renewed,json={}).json()['challenge']
            bad_signature = {matrix_user(users[1]):{'ed25519:'+ids[1]:encode(signing[0].sign(canonical(challenge)))}}
            assert client.post('/api/secret/devices/'+ids[1]+'/session-proof',headers=renewed,json={'challenge':challenge,'signatures':bad_signature}).status_code == 422
            signature = {matrix_user(users[1]):{'ed25519:'+ids[1]:encode(signing[1].sign(canonical(challenge)))}}
            proof = {'challenge':challenge,'signatures':signature}
            assert client.post('/api/secret/devices/'+ids[1]+'/session-proof',headers=headers[1],json=proof).status_code == 403
            assert client.post('/api/secret/devices/'+ids[1]+'/session-proof',headers=renewed,json=proof).status_code == 200
            assert client.post('/api/secret/devices/'+ids[1]+'/session-proof',headers=renewed,json=proof).status_code == 403
            assert client.get('/api/secret/chats',headers=renewed).status_code == 200
            assert client.get('/api/secret/chats',headers=headers[1]).status_code == 403
            headers[1] = renewed
            assert client.delete('/api/secret/devices/'+ids[1],headers=headers[1]).status_code == 204
            assert client.post('/api/secret/devices/'+ids[1]+'/session-challenge',headers=renewed,json={}).status_code == 410
            assert client.get('/api/secret/chats/'+chat+'/envelopes',headers=headers[0]).status_code == 410
            assert client.get(url,headers=headers[0]).status_code == 410
            cleanup_secret_data()
            assert not chunk_path(upload_id,0).exists()
            with SessionLocal() as db:
                assert db.get(SecretUpload,UUID(upload_id)) is None
        finally:
            for _, user in accounts:
                delete_user(user['email'])
