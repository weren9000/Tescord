"""Persistent collectible catalog; preserve identifiers of existing items."""
from alembic import op
import sqlalchemy as sa
revision = '20261013_0028'
down_revision = '20261013_0027'
branch_labels = None
depends_on = None

def upgrade():
    table = op.create_table('inventory_catalog',
        sa.Column('id',sa.String(64),primary_key=True),
        sa.Column('name',sa.String(80),nullable=False),
        sa.Column('kind',sa.String(16),nullable=False),
        sa.Column('builtin',sa.Boolean(),nullable=False),
        sa.Column('hidden',sa.Boolean(),nullable=False,server_default='false'),
        sa.Column('created_by',sa.Uuid(),sa.ForeignKey('users.id',ondelete='SET NULL')),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False,server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('avatar', 'frame')",name='ck_catalog_kind'))
    op.bulk_insert(table, [{'id': 'cyber-oni', 'name': 'Кибер-Они', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'shark', 'name': 'Акула', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'chameleon', 'name': 'Хамелеон', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'alpaca', 'name': 'Альпака', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'crocodile', 'name': 'Крокодил', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'toucan', 'name': 'Тукан', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'horse', 'name': 'Лошадка', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'axolotl', 'name': 'Аксолотль', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'octopus', 'name': 'Осьминог', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'unicorn', 'name': 'Единорог', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'dragon', 'name': 'Дракон', 'kind': 'avatar', 'builtin': True, 'hidden': False},
     {'id': 'frame-neon', 'name': 'Неоновый поток', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-cyber-oni', 'name': 'Кибер-Они', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-aurora',
      'name': 'Северное сияние',
      'kind': 'frame',
      'builtin': True,
      'hidden': False},
     {'id': 'frame-obsidian', 'name': 'Обсидиан', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-ice', 'name': 'Ледяная грань', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-solar-gold',
      'name': 'Солнечное золото',
      'kind': 'frame',
      'builtin': True,
      'hidden': False},
     {'id': 'frame-sakura', 'name': 'Сакура', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-orbit', 'name': 'Орбита', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-emerald', 'name': 'Изумруд', 'kind': 'frame', 'builtin': True, 'hidden': False},
     {'id': 'frame-kva', 'name': 'Ква-рамка', 'kind': 'frame', 'builtin': True, 'hidden': False}])
    op.create_foreign_key('fk_inventory_catalog','inventory_items','inventory_catalog',['catalog_id'],['id'])
    op.create_index('ix_catalog_kind_created','inventory_catalog',['kind','created_at','id'])

def downgrade():
    op.drop_constraint('fk_inventory_catalog','inventory_items',type_='foreignkey')
    op.drop_table('inventory_catalog')
