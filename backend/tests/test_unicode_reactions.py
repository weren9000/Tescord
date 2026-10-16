from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from test_auth_workspace import (login_admin_user, register_regular_user, delete_user,
    create_temp_text_channel, delete_server)


def test_unicode_reactions_aliases_validation_and_access():
    with TestClient(app) as client:
        token = login_admin_user(client)
        headers = {'Authorization': 'Bearer '+token}
        outsider, form = register_regular_user(client)
        group, channel = create_temp_text_channel(client, token, uuid4().hex[:6])
        try:
            message = client.post(f"/api/channels/{channel['id']}/messages", headers=headers,
                                  data={'content': 'unicode reactions'}).json()
            path = f"/api/messages/{message['id']}/reactions/"
            assert client.put(path+'🐸').status_code == 401
            assert client.put(path+'🐸', headers={'Authorization':'Bearer '+outsider}).status_code in (403,404)
            assert client.put(path+'invalid', headers=headers).status_code == 400
            for code in ['heart', '❤️', '🐸', '🐸']:
                response = client.put(path+code, headers=headers)
                assert response.status_code == 200, response.text
            assert response.json()['reactions'] == [
                {'code':'heart','count':1,'reacted':True}, {'code':'🐸','count':1,'reacted':True}]
            assert client.delete(path+'❤️', headers=headers).json()['reactions'] == [
                {'code':'🐸','count':1,'reacted':True}]
            assert client.delete(path+'🐸', headers=headers).json()['reactions'] == []
        finally:
            delete_server(group['id'])
            delete_user(form['email'])
