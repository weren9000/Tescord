"""Seed twenty collectible wallpapers supplied by the user."""
from alembic import op
import sqlalchemy as sa

revision = '20261014_0032'
down_revision = '20261013_0031'
branch_labels = None
depends_on = None

ITEMS = {'wallpaper-mint-animals': 'Мятные зверята', 'wallpaper-peach-games': 'Персиковый игровой мир', 'wallpaper-forest-tales': 'Лесные истории', 'wallpaper-enchanted-kingdom': 'Зачарованное королевство', 'wallpaper-blue-space': 'Голубой космос', 'wallpaper-lavender-magic': 'Лавандовая магия', 'wallpaper-royal-knights': 'Королевские рыцари', 'wallpaper-northern-sagas': 'Северные саги', 'wallpaper-pirate-treasure': 'Пиратские сокровища', 'wallpaper-golden-alchemy': 'Золотая алхимия', 'wallpaper-tactical-arena': 'Тактическая арена', 'wallpaper-lilac-witchcraft': 'Сиреневое колдовство', 'wallpaper-turquoise-cyberpunk': 'Бирюзовый киберпанк', 'wallpaper-blue-cyberpunk': 'Синий киберпанк', 'wallpaper-vintage-witchcraft': 'Винтажное колдовство', 'wallpaper-pink-cyberpunk': 'Розовый киберпанк', 'wallpaper-green-witchcraft': 'Зелёное колдовство', 'wallpaper-sunny-farm': 'Солнечная ферма', 'wallpaper-elven-crystals': 'Эльфийские кристаллы', 'wallpaper-elven-forest': 'Эльфийский лес'}


def upgrade():
    table = sa.table('inventory_catalog', sa.column('id'), sa.column('name'), sa.column('kind'), sa.column('builtin'), sa.column('hidden'))
    op.bulk_insert(table, [dict(id=key, name=name, kind='wallpaper', builtin=True, hidden=False) for key, name in ITEMS.items()])


def downgrade():
    # Existing grants are protected by inventory foreign keys.
    table = sa.table('inventory_catalog', sa.column('id'))
    op.execute(table.delete().where(table.c.id.in_(list(ITEMS))))
