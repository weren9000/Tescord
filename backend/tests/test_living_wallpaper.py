from test_inventory import accounts
import pytest


@pytest.mark.parametrize('catalog_id,keyframe', [('wallpaper-living-marsh','drift'),('wallpaper-living-valheim','veil')])
def test_living_wallpaper_static_preview_and_motion(accounts,catalog_id,keyframe):
    client,people=accounts
    path='/api/inventory/assets/'+catalog_id
    poster=client.get(path)
    assert poster.status_code==200 and poster.headers['content-type']=='image/png'
    animated=client.get(path+'?live=true&motion=true')
    assert animated.status_code==200 and animated.headers['content-type'].startswith('image/svg+xml')
    assert '@keyframes '+keyframe in animated.text and len(animated.content)<70000
    static=client.get(path+'?live=true&motion=false')
    assert '@keyframes' not in static.text
    preview=client.get(path+'?preview=true&live=true')
    assert preview.status_code==200 and preview.headers['content-type']=='image/webp'
    assert len(preview.content)<50000
    headers,_,_=people[1]
    assert catalog_id not in [p['id'] for p in client.get('/api/wallpapers',headers=headers).json()['presets']]
    assert client.put('/api/wallpapers',headers=headers,json={'selected':catalog_id}).status_code==400
