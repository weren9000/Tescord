"""Five rarity levels shared by the shop and owned items; classify existing catalog."""
from alembic import op
import sqlalchemy as sa

revision = '20261020_0047'
down_revision = '20261020_0046'
branch_labels = None
depends_on = None

# Editorial classification by catalog ID, independent of price and publication.
# Existing manually assigned rarities take precedence.
GROUPS = {
    'uncommon': [
        'chameleon', 'crocodile', 'toucan', 'shark', 'frame-emerald', 'frame-ice',
        'theme-amber', 'theme-lavender', 'theme-ocean', 'theme-emerald',
        'wallpaper-forest-tales', 'wallpaper-lavender-magic', 'wallpaper-peach-games',
        'wallpaper-pirate-treasure', 'wallpaper-tactical-arena',
        '0bb87ced-149d-4d28-950a-52f4459a0b8b', # Жучара
        '5d3f7a91-a0ad-4aef-802b-8adac06aaa57', # Мотыль
        '6735254a-ef72-4a23-a709-113b0130649f', # Павук
        '699c11c4-7fad-49a8-8d0c-ed28e791dd2a', # Улитыч
        '7caa10e3-ff99-439c-b911-6af270751c78', # Дельфин
    ],
    'rare': [
        'axolotl', 'octopus', 'frame-neon', 'frame-sakura', 'frame-orbit',
        'theme-sakura', 'theme-viking', 'wallpaper-blue-space',
        'wallpaper-elven-forest', 'wallpaper-green-witchcraft',
        'wallpaper-lilac-witchcraft', 'wallpaper-vintage-witchcraft',
        'wallpaper-northern-sagas', 'wallpaper-royal-knights',
        '5ed88968-02fb-4a8b-b568-7d6f36515210', # Скорпи
        '81f7eeab-a239-4687-a70b-9124d1df6339', # Мейн
        'f1363725-e623-4a49-a0c0-2fd125cb2cee', # Змий
        '59867da2-ad14-4e95-8815-323e36529a05', # Дота Мир
        '7b391d9c-2724-4d95-9e92-36b0ccdb459e', # КС Мир
    ],
    'epic': [
        'frame-aurora', 'frame-obsidian', 'theme-cyberpunk', 'theme-space',
        'wallpaper-blue-cyberpunk', 'wallpaper-pink-cyberpunk',
        'wallpaper-turquoise-cyberpunk', 'wallpaper-elven-crystals',
        'wallpaper-enchanted-kingdom', 'wallpaper-golden-alchemy',
        '141b3a89-52ec-41ba-9079-9c0f19fb8d0a', # Эльф by Lev
        '86510a26-6947-43e3-9550-1ae409cfc03f', # Траума
        'f7ef3d0c-bf1e-44c0-aa68-eba2bfbbef10', # Ведьма by Olga
        '0f29c458-40ff-4e2e-9a92-d317d42dfd06', # Неоновые Кибер-тянки
        'bae34e75-c43a-4f6a-b3b3-b2d89852bcc5', # Кибер-тянки 2077
    ],
    'legendary': [
        'dragon', 'unicorn', 'cyber-oni', 'frame-cyber-oni', 'frame-solar-gold',
        'wallpaper-living-marsh', 'wallpaper-living-valheim',
    ],
}


def upgrade():
    op.drop_constraint('ck_shop_rarity', 'shop_offers', type_='check')
    allowed = "rarity IS NULL OR rarity IN ('common','uncommon','rare','epic','legendary')"
    op.create_check_constraint('ck_shop_rarity', 'shop_offers', allowed)
    op.add_column('inventory_catalog', sa.Column('rarity', sa.String(16), nullable=True))
    op.create_check_constraint('ck_catalog_rarity', 'inventory_catalog', allowed)
    db = op.get_bind()
    db.execute(sa.text('UPDATE inventory_catalog c SET rarity=o.rarity FROM shop_offers o WHERE o.catalog_id=c.id'))
    for rarity, ids in GROUPS.items():
        query = sa.text('UPDATE inventory_catalog SET rarity=:rarity WHERE rarity IS NULL AND id IN :ids')
        db.execute(query.bindparams(sa.bindparam('ids', expanding=True)), {'rarity': rarity, 'ids': ids})
    db.execute(sa.text("UPDATE inventory_catalog SET rarity='common' WHERE rarity IS NULL"))
    db.execute(sa.text('UPDATE shop_offers o SET rarity=c.rarity, version=o.version+1 FROM inventory_catalog c WHERE c.id=o.catalog_id AND o.rarity IS DISTINCT FROM c.rarity'))


def downgrade():
    op.drop_constraint('ck_catalog_rarity', 'inventory_catalog', type_='check')
    op.drop_column('inventory_catalog', 'rarity')
    op.execute("UPDATE shop_offers SET rarity='common', version=version+1 WHERE rarity='uncommon'")
    op.drop_constraint('ck_shop_rarity', 'shop_offers', type_='check')
    op.create_check_constraint('ck_shop_rarity', 'shop_offers', "rarity IS NULL OR rarity IN ('common','rare','epic','legendary')")
