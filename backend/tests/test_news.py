from io import BytesIO
from uuid import UUID

from PIL import Image
from sqlalchemy import delete

from app.db.models import User
from app.db.news import NewsPost
from app.db.session import SessionLocal
from test_inventory import accounts


def data(**changes):
    return dict(title='Новый звонок', excerpt='Коротко о главном', body='Первая строка\n\nВторая строка',
                published='false', version='0', **changes)


def promote(people):
    with SessionLocal() as db:
        db.get(User, UUID(people[0][1]['id'])).is_admin = True
        db.commit()
    return people[0][0]


def cleanup():
    with SessionLocal() as db:
        db.execute(delete(NewsPost))
        db.commit()


def test_news_permissions_publication_conflict_and_images(accounts):
    client, people = accounts
    cleanup()
    regular = people[1][0]
    avatar_admin = people[0][0]
    assert client.post('/api/admin/news', data=data()).status_code == 401
    for headers in (regular, avatar_admin):
        assert client.get('/api/admin/news', headers=headers).status_code == 403
        assert client.post('/api/admin/news', headers=headers, data=data()).status_code == 403
    admin = promote(people)
    source = BytesIO()
    Image.new('RGB', (60, 40), 'purple').save(source, 'PNG')
    result = client.post('/api/admin/news', headers=admin, data=data(),
                         files={'image': ('cover.png', source.getvalue(), 'image/png')})
    assert result.status_code == 201, result.text
    draft = result.json()
    key = draft['id']
    assert draft['has_image'] and not draft['published']
    assert draft['version'] == 1
    for suffix in ('', '/image'):
        response = client.get('/api/news/' + key + suffix)
        assert response.status_code == 404
        assert response.headers['cache-control'] == 'no-store'
    assert client.get('/api/news').json()['total'] == 0
    assert client.get('/api/admin/news', headers=admin).json()['items'][0]['body'] == data()['body']
    assert client.get(f'/api/admin/news/{key}/image', headers=regular).status_code == 403
    assert client.get(f'/api/admin/news/{key}/image', headers=admin).headers['content-type'] == 'image/webp'
    payload = data()
    payload.update(version='1', published='true')
    published = client.put('/api/admin/news/' + key, headers=admin, data=payload)
    assert published.status_code == 200, published.text
    assert published.json()['version'] == 2
    feed = client.get('/api/news')
    assert feed.headers['cache-control'] == 'no-store'
    assert feed.json()['total'] == 1
    public = feed.json()['items'][0]
    assert 'body' not in public and 'updated_by' not in public and 'version' not in public
    assert client.get('/api/news/' + key).json()['body'] == data()['body']
    image = client.get('/api/news/' + key + '/image')
    assert Image.open(BytesIO(image.content)).format == 'WEBP'
    assert client.put('/api/admin/news/' + key, headers=admin, data=payload).status_code == 409
    payload.update(version='2', published='false')
    assert client.put('/api/admin/news/' + key, headers=regular, data=payload).status_code == 403
    assert client.put('/api/admin/news/' + key, headers=admin, data=payload).status_code == 200
    assert client.get('/api/news').json()['total'] == 0
    assert client.get('/api/news/' + key + '/image?v=2').status_code == 404
    payload.update(version='3', published='true', remove_image='true')
    assert client.put('/api/admin/news/' + key, headers=admin, data=payload).json()['image_url'] is None
    assert client.get('/api/news/' + key + '/image').status_code == 404
    cleanup()


def test_news_validation_and_pagination(accounts):
    client, people = accounts
    cleanup()
    admin = promote(people)
    for field, value in [('title', ' '), ('title', 'x' * 161), ('excerpt', 'x' * 321), ('body', 'x' * 20001)]:
        payload = data()
        payload[field] = value
        assert client.post('/api/admin/news', headers=admin, data=payload).status_code == 422
    for raw, expected in [(b'<svg onload="alert(1)"/>', 422), (b'x' * (4 * 1024 * 1024 + 1), 413)]:
        assert client.post('/api/admin/news', headers=admin, data=data(),
                           files={'image': ('bad.png', raw, 'image/png')}).status_code == expected
    for i in range(4):
        payload = data()
        payload.update(title=str(i), published='true')
        assert client.post('/api/admin/news', headers=admin, data=payload).status_code == 201
    first = client.get('/api/news?size=3').json()
    second = client.get('/api/news?size=3&page=2').json()
    assert first['total'] == 4 and first['pages'] == 2
    assert [p['title'] for p in first['items']] == ['3', '2', '1']
    assert [p['title'] for p in second['items']] == ['0']
    assert client.get('/api/news?size=1000').status_code == 422
    cleanup()
