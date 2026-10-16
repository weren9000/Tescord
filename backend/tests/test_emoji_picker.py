from app.services.emoji_catalog import CATALOG, ALLOWED
from test_inventory import accounts


def test_emoji_choices_are_valid_ranked_and_private(accounts):
    client, people = accounts
    first, _, _ = people[0]
    second, _, _ = people[1]
    path = '/api/users/me/emojis'
    assert len(ALLOWED) > 350
    assert sum(len(g['items']) for g in CATALOG) == len(ALLOWED)
    assert client.get(path).status_code == 401
    assert client.post(path+'/use', json={'emoji':'😀'}).status_code == 401
    response=client.get(path, headers=first)
    assert response.status_code == 200 and response.headers['cache-control']=='no-store'
    assert response.json()['frequent']==[]
    assert client.post(path+'/use', headers=first, json={'emoji':'<script>'}).status_code==422
    for emoji in ['😂','🐸','🐸','😂','💚']:
        assert client.post(path+'/use', headers=first, json={'emoji':emoji}).status_code==200
    assert client.get(path, headers=first).json()['frequent']==['😂','🐸','💚']
    assert client.get(path, headers=second).json()['frequent']==[]
    for emoji in ['😀','😃','😄','😁','😆','😅','😊','🙂','🙃','😉','😍']:
        client.post(path+'/use', headers=first, json={'emoji':emoji}).raise_for_status()
    top=client.get(path, headers=first).json()['frequent']
    assert len(top)==10 and top[:2]==['😂','🐸'] and top[2]=='😍'
