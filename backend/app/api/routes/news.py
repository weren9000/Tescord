"""Plain-text news, bounded images, and versioned editorial updates."""
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID
import warnings

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.api.routes.admin_directory import require_admin
from app.db.models import User
from app.db.news import NewsPost
from app.db.session import get_db

router = APIRouter(tags=['news'])
admin = APIRouter(prefix='/admin/news', dependencies=[Depends(require_admin)])
MAX_IMAGE = 4 * 1024 * 1024


def serialize(post, *, detail=False, private=False):
    data = dict(id=str(post.id), title=post.title, excerpt=post.excerpt,
                published_at=post.published_at,
                image_url=f'/api/news/{post.id}/image?v={post.version}' if post.has_image else None)
    if detail or private:
        data['body'] = post.body
    if private:
        data.update(published=post.published, version=post.version,
                    created_at=post.created_at, updated_at=post.updated_at, has_image=post.has_image)
    return data


def listing(db, response, page, size, private=False):
    response.headers['Cache-Control'] = 'no-store'
    query = select(NewsPost)
    if not private:
        query = query.where(NewsPost.published.is_(True), NewsPost.published_at <= func.now())
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    order = NewsPost.updated_at if private else NewsPost.published_at
    posts = db.scalars(query.order_by(order.desc(), NewsPost.id.desc()).offset((page - 1) * size).limit(size))
    return dict(items=[serialize(post, private=private) for post in posts],
                total=total, page=page, pages=max(1, (total + size - 1) // size))


def find(db, key, *, private=False, lock=False):
    query = select(NewsPost).where(NewsPost.id == key)
    if not private:
        query = query.where(NewsPost.published.is_(True), NewsPost.published_at <= func.now())
    if lock:
        query = query.with_for_update()
    post = db.scalar(query)
    if not post:
        raise HTTPException(404, 'Новость не найдена', headers={'Cache-Control': 'no-store'})
    return post


@router.get('/news')
def public_list(response: Response, page: int = Query(1, ge=1, le=10000),
                size: int = Query(12, ge=1, le=20), db: Session = Depends(get_db)):
    return listing(db, response, page, size)


@router.get('/news/{key}')
def public_detail(key: UUID, response: Response, db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return serialize(find(db, key), detail=True)


def image_response(post):
    if not post.has_image or not post.image:
        raise HTTPException(404, 'Изображение не найдено', headers={'Cache-Control': 'no-store'})
    return Response(post.image, media_type='image/webp', headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/news/{key}/image')
def public_image(key: UUID, db: Session = Depends(get_db)):
    return image_response(find(db, key))


@admin.get('')
def admin_list(response: Response, page: int = Query(1, ge=1, le=10000),
               size: int = Query(12, ge=1, le=20), db: Session = Depends(get_db)):
    return listing(db, response, page, size, private=True)


@admin.get('/{key}/image')
def admin_image(key: UUID, db: Session = Depends(get_db)):
    return image_response(find(db, key, private=True))


def prepared_image(upload):
    if upload is None:
        return None
    raw = upload.file.read(MAX_IMAGE + 1)
    if len(raw) > MAX_IMAGE:
        raise HTTPException(413, 'Картинка должна быть не больше 4 МБ')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format not in {'JPEG', 'PNG', 'WEBP'} or image.width * image.height > 16_000_000:
                    raise ValueError('Unsupported image')
                image = ImageOps.exif_transpose(image)
                image.thumbnail((1600, 1200))
                result = BytesIO()
                image.convert('RGB').save(result, 'WEBP', quality=85)
                return result.getvalue()
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'Выберите PNG, JPEG или WebP до 16 мегапикселей') from None


def fields(title: str = Form(..., min_length=1, max_length=160),
           excerpt: str = Form(..., min_length=1, max_length=320),
           body: str = Form(..., min_length=1, max_length=20000),
           published: bool = Form(False), version: int = Form(0, ge=0),
           remove_image: bool = Form(False), image: UploadFile | None = File(None)):
    values = {'title': title.strip(), 'excerpt': excerpt.strip(), 'body': body.strip()}
    if not all(values.values()):
        raise HTTPException(422, 'Заполните заголовок, короткое описание и текст')
    return values, published, version, remove_image, image


def save(db, post, payload, actor):
    values, published, _, remove_image, upload = payload
    content = prepared_image(upload)
    for field, value in values.items():
        setattr(post, field, value)
    now = datetime.now(timezone.utc)
    post.published = published
    if published and post.published_at is None:
        post.published_at = now
    if content is not None:
        post.image, post.has_image = content, True
    elif remove_image:
        post.image, post.has_image = None, False
    post.updated_by, post.updated_at = actor.id, now
    db.add(post)
    db.commit()
    db.refresh(post)
    return serialize(post, private=True)


@admin.post('', status_code=201)
def create(payload=Depends(fields), actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload[2] != 0:
        raise HTTPException(409, 'Для новой новости версия должна быть нулевой')
    return save(db, NewsPost(version=1), payload, actor)


@admin.put('/{key}')
def update(key: UUID, payload=Depends(fields), actor: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = find(db, key, private=True, lock=True)
    if post.version != payload[2]:
        raise HTTPException(409, 'Новость уже изменили. Скопируйте свой текст и откройте её заново.')
    post.version += 1
    return save(db, post, payload, actor)


router.include_router(admin)
