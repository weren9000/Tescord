"""Import the approved collection. Run from backend with PYTHONPATH=. and --apply.

Existing catalog entries, offers and collection settings are never overwritten.
Images are validated before any database changes; one transaction publishes the set.
"""
import argparse
import hashlib
import json
from pathlib import Path
from uuid import UUID

from PIL import Image
from app.db.session import SessionLocal
from app.db.inventory import InventoryCatalog
from app.db.shop import ShopOffer, ShopAudit, ShopCollection, ShopCollectionItem
from app.services.inventory import asset_path, lock_inventory
from app.services.image_previews import preview_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    data = json.loads(args.manifest.read_text(encoding='utf8'))
    UUID(data['id'])
    assert len(data['items']) == 10
    assert len({i['id'] for i in data['items']}) == 10
    assert data['cover_id'] in {i['id'] for i in data['items']}
    payloads = {}
    for item in data['items']:
        UUID(item['id'])
        assert item['rarity'] in ('common', 'uncommon', 'rare', 'epic', 'legendary')
        assert isinstance(item['price'], int) and 1 <= item['price'] <= 1000000000
        source = args.manifest.parent / (item['slug'] + '.webp')
        assert source.resolve().parent == args.manifest.parent.resolve()
        with Image.open(source) as image:
            assert image.format == 'WEBP' and image.size == (512, 512)
            image.load()
        payloads[item['id']] = source.read_bytes()
    if not args.apply:
        print('Validated 10 avatars, prices, rarities and collection. Use --apply to import.')
        return
    with SessionLocal() as db:
        lock_inventory(db)
        for position, item in enumerate(data['items']):
            key = item['id']
            target = asset_path(key)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(payloads[key]).digest(), 'Asset conflict: '+key
            else:
                with target.open('xb') as output:
                    output.write(payloads[key])
            preview_path(target, 256)
            if not db.get(InventoryCatalog, key):
                db.add(InventoryCatalog(id=key, name=item['name'], kind='avatar',
                                        builtin=False, hidden=False, rarity=item['rarity']))
                db.flush()
            if not db.get(ShopOffer, key):
                db.add(ShopOffer(catalog_id=key, price=item['price'], rarity=item['rarity'],
                                 status='published', recommended=True, position=position, version=1))
                db.add(ShopAudit(actor_name=('Каталог: '+data['name'])[:32], target=key, before={},
                                 after={'price': item['price'], 'rarity': item['rarity'], 'status': 'published'}))
        db.flush()
        if not db.get(ShopCollection, data['id']):
            db.add(ShopCollection(id=data['id'], name=data['name'], description=data['description'],
                                 cover_id=data['cover_id'], artwork=None, published=True, position=0, version=1))
            db.flush()
            for item in data['items']:
                db.add(ShopCollectionItem(collection_id=data['id'], catalog_id=item['id']))
            db.add(ShopAudit(actor_name=('Каталог: '+data['name'])[:32], target=data['id'], before={},
                             after={'name': data['name'], 'items': [i['id'] for i in data['items']]}))
        db.commit()
    print('Collection imported; existing settings preserved.')


if __name__ == '__main__':
    main()
