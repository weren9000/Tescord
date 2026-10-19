from uuid import uuid4
from test_inventory import accounts


def test_card_tracks_request_and_friendship_states(accounts):
    c, users=accounts
    a,alice,_=users[0];b,bob,_=users[1]
    url='/api/friends/users/'+bob['id']
    assert c.get(url).status_code==401
    assert c.get('/api/friends/users/'+str(uuid4()),headers=a).status_code==404
    assert c.get(url,headers=b).json()['state']=='self'
    card=c.get(url,headers=a)
    assert card.json()['state']=='ready'
    assert 'email' not in card.text and 'password' not in card.text
    assert card.headers['cache-control']=='no-store'
    request=c.post('/api/friends/requests',headers=a,json={'user_id':bob['id']}).json()
    assert c.get(url,headers=a).json()['state']=='outgoing'
    reverse='/api/friends/users/'+alice['id']
    assert c.get(reverse,headers=b).json()['state']=='incoming'
    assert c.get(reverse,headers=b).json()['request_id']==request['id']
    c.post('/api/friends/requests/'+request['id']+'/accept',headers=b)
    card=c.get(url,headers=a).json()
    assert card['state']=='friends' and card['server_id']


def test_blocks_are_not_disclosed_and_mutual_blocks_work(accounts):
    c,users=accounts;a,alice,_=users[0];b,bob,_=users[1]
    c.post('/api/friends/'+bob['id']+'/block',headers=a)
    assert c.get('/api/friends/users/'+bob['id'],headers=a).json()['state']=='unavailable'
    assert c.get('/api/friends/users/'+alice['id'],headers=b).json()['state']=='unavailable'
    c.post('/api/friends/'+alice['id']+'/block',headers=b)
    assert c.get('/api/friends/users/'+bob['id'],headers=a).json()['state']=='unavailable'
    assert c.post('/api/friends/requests',headers=a,json={'user_id':bob['id']}).status_code==403
