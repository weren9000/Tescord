"""Call-key delivery is scoped to a live, authorized participant, including guests."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.db.secret_chats import MediaCryptoEnvelope
from test_meeting_rooms import meeting, join, auth
from test_secret_chats import device_payload, encode


def test_media_key_transport_scope_signatures_retry_and_revocation(meeting, monkeypatch):
    c, account, owner = meeting
    settings = get_settings()
    monkeypatch.setattr(settings, 'media_encryption_enabled', True)
    monkeypatch.setattr(settings, 'livekit_url', 'ws://127.0.0.1:7895')
    monkeypatch.setattr(settings, 'livekit_api_key', 'localtest')
    monkeypatch.setattr(settings, 'livekit_api_secret', 'isolated-local-livekit-test-secret')
    guest = join(c, owner).json()
    tickets = [owner, guest]
    ids = [str(uuid4()) for _ in tickets]
    headers, payloads = [], []
    assert c.post('/api/rooms/media', headers=auth(owner['token'])).status_code == 426
    for index, ticket in enumerate(tickets):
        response = c.post('/api/rooms/media', headers={**auth(ticket['token']), 'X-Kva-Media-Crypto':'olm-livekit-v1'})
        assert response.status_code == 200, response.text
        scope = response.json()['media_crypto']
        assert scope['identity'] == ticket['participant_id']
        headers.append({'X-Media-Token':scope['token'],'X-Media-Device':ids[index]})
        payloads.append(device_payload(ticket['participant_id'], ids[index]))
        response = c.put('/api/media-encryption/devices/'+ids[index]+'/keys', headers=headers[index], json=payloads[index])
        assert response.status_code == 200, response.text
        assert c.get('/api/me',headers=auth(scope['token'])).status_code == 401
    assert c.get('/api/media-encryption/state',headers={**headers[0], 'X-Media-Device':ids[1]}).status_code == 403
    assert c.get('/api/media-encryption/state',headers={'X-Media-Token':account,'X-Media-Device':ids[0]}).status_code == 403
    assert c.get('/api/media-encryption/state',headers=headers[0]).headers['cache-control'] == 'no-store'
    replacement = device_payload(owner['participant_id'], ids[0])
    assert c.put('/api/media-encryption/devices/'+ids[0]+'/keys',headers=headers[0],json=replacement).status_code == 409
    bad = device_payload(owner['participant_id'], str(uuid4()))
    bad['device_keys']['keys']['ed25519:'+bad['device_keys']['device_id']] = encode(bytes(32))
    assert c.put('/api/media-encryption/devices/'+bad['device_keys']['device_id']+'/keys',headers=headers[0],json=bad).status_code == 422
    claim = {'device_id':ids[1]}
    assert c.post('/api/media-encryption/claim',headers=headers[0],json=claim).json()['one_time_keys']
    assert c.post('/api/media-encryption/claim',headers=headers[0],json=claim).json()['one_time_keys'] == {}
    assert c.put('/api/media-encryption/devices/'+ids[1]+'/keys',headers=headers[1],json=payloads[1]).json()['one_time_key_counts']['signed_curve25519'] == 0
    def envelope(sender, recipient):
        return {'client_id':str(uuid4()),'recipient_id':ids[recipient], 'ciphertext':{
            'algorithm':'m.olm.v1.curve25519-aes-sha2',
            'sender_key':payloads[sender]['device_keys']['keys']['curve25519:'+ids[sender]],
            'ciphertext':{payloads[recipient]['device_keys']['keys']['curve25519:'+ids[recipient]]:{'type':0,'body':encode(b'opaque synthetic Olm envelope')}}}}
    bodies = [envelope(0,1),envelope(1,0)]
    # Reciprocal sends and retries do not deadlock or create duplicate delivery.
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda i:c.post('/api/media-encryption/envelopes',headers=headers[i%2],json=bodies[i%2]),range(4)))
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert responses[0].json() == responses[2].json()
    sequence = responses[0].json()['sequence']
    assert c.post('/api/media-encryption/envelopes',headers=headers[0],json={**bodies[0],'ciphertext':{'key':'plaintext'}}).status_code == 422
    c.post('/api/media-encryption/ack',headers=headers[0],json={'sequences':[sequence]})
    assert c.get('/api/media-encryption/state',headers=headers[1]).json()['envelopes']
    c.post('/api/media-encryption/ack',headers=headers[1],json={'sequences':[sequence]})
    assert c.get('/api/media-encryption/state',headers=headers[1]).json()['envelopes'] == []
    assert c.post('/api/media-encryption/envelopes',headers=headers[0],json=bodies[0]).json()['sequence'] == sequence
    with SessionLocal() as db:
        assert db.get(MediaCryptoEnvelope,sequence).ciphertext == {}
    # Leaving invalidates the scoped grant, including a guest without an account.
    assert c.post('/api/rooms/leave',headers=auth(guest['token'])).status_code == 200
    assert c.get('/api/media-encryption/state',headers=headers[1]).status_code == 403
    monkeypatch.setattr(settings, 'livekit_url', None)
    assert c.post('/api/rooms/control',headers=auth(owner['token']),json={'action':'end'}).status_code == 200
    assert c.get('/api/media-encryption/state',headers=headers[0]).status_code == 403
