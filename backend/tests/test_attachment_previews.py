from io import BytesIO
from uuid import UUID
from unittest.mock import patch
import hashlib
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db.models import Attachment
from app.db.session import SessionLocal
from app.services.attachment_previews import ensure_preview, preview_paths
from app.services.attachment_storage import resolve_attachment_path, delete_stored_attachment
from test_auth_workspace import register_regular_user, delete_user, delete_server


def test_preview_orientation_alpha_animation_bounds_and_cache(tmp_path):
    jpeg=tmp_path/'rotated.jpg'
    exif=Image.Exif();exif[274]=6
    Image.new('RGB',(1200,600),'red').save(jpeg,exif=exif)
    original=jpeg.read_bytes()
    preview=ensure_preview(jpeg)
    with Image.open(preview) as image:assert image.size==(320,640)
    assert jpeg.read_bytes()==original
    with patch('app.services.attachment_previews.Image.open',side_effect=AssertionError('cached')):
        assert ensure_preview(jpeg)==preview
    png=tmp_path/'transparent.png'
    Image.new('RGBA',(180,90),(10,20,30,0)).save(png)
    with Image.open(ensure_preview(png)) as image:
        assert image.size==(180,90) and image.getpixel((0,0))[3]==0
    gif=tmp_path/'animated.gif'
    frames=[Image.new('RGB',(100,80),color) for color in ['red','blue']]
    frames[0].save(gif,save_all=True,append_images=frames[1:],duration=100,loop=0)
    with Image.open(ensure_preview(gif)) as image:assert getattr(image,'n_frames',1)==1
    bad=tmp_path/'broken.png';bad.write_bytes(b'not an image');assert ensure_preview(bad) is None
    with patch('app.services.attachment_previews.MAX_PREVIEW_PIXELS',1):
        huge=tmp_path/'limited.png';Image.new('RGB',(2,2)).save(huge);assert ensure_preview(huge) is None
    assert not list(tmp_path.glob('*.part'))


def test_preview_api_permissions_original_integrity_lazy_generation_and_delete():
    with TestClient(app) as client:
        accounts=[register_regular_user(client) for _ in range(2)]
        headers=[{'Authorization':'Bearer '+account[0]} for account in accounts]
        sid=None;paths=[]
        try:
            group=client.post('/api/conversations/group',headers=headers[0],json={'name':'Photo preview test','member_user_ids':[]});assert group.status_code==201
            sid=group.json()['id']
            channels=client.get('/api/servers/'+sid+'/channels',headers=headers[0]).json()
            cid=next(channel['id'] for channel in channels if channel['type']=='text')
            source=BytesIO();Image.new('RGB',(1800,1200),'green').save(source,format='PNG');content=source.getvalue()
            sent=client.post(f'/api/channels/{cid}/messages',headers=headers[0],files={'files':('photo.png',content,'image/png')});assert sent.status_code==201,sent.text
            aid=sent.json()['attachments'][0]['id'];url='/api/attachments/'+aid
            with SessionLocal() as db:
                row=db.get(Attachment,UUID(aid));paths.append(row.storage_path);path=resolve_attachment_path(row.storage_path)
            target,_=preview_paths(path);assert target.exists()
            target.unlink() # Simulate an attachment created by a previous version.
            assert client.get(url+'/preview').status_code==401
            assert client.get(url+'/preview',headers=headers[1]).status_code in {403,404}
            preview=client.get(url+'/preview',headers=headers[0]);assert preview.status_code==200
            assert preview.headers['content-type']=='image/webp'
            assert preview.headers['cache-control'].startswith('private')
            assert preview.headers['vary']=='Authorization'
            with Image.open(BytesIO(preview.content)) as image:assert image.size==(640,427)
            assert client.get(url,headers=headers[0]).content==content
            assert client.delete(url,headers=headers[0]).status_code==204
            assert not path.exists() and not target.exists()
            assert client.get(url+'/preview',headers=headers[0]).status_code in {404,410}
        finally:
            for path in paths:delete_stored_attachment(path)
            if sid:delete_server(sid)
            for _,account in accounts:delete_user(account['email'])
