"""Integration tests must use an explicitly selected, local disposable database."""
import os
from urllib.parse import urlsplit

database = urlsplit(os.environ.get('TESCORD_DATABASE_URL', ''))
if database.hostname not in {'localhost', '127.0.0.1'} or not database.path.rsplit('/', 1)[-1].startswith(('test', 'kva_fix')):
    raise RuntimeError('Set TESCORD_DATABASE_URL to a local test* or kva_fix* database; never use production data')
os.environ['TESCORD_ENVIRONMENT'] = 'development'
os.environ['TESCORD_SEED_DEMO_DATA'] = 'true'
os.environ['TESCORD_DEMO_PASSWORD'] = 'testing-only-not-for-production'
os.environ['TESCORD_DEMO_SERVER_NAME'] = 'Altgramm'
os.environ['TESCORD_DEBUG'] = 'false'
os.environ['TESCORD_RATE_LIMITS_ENABLED'] = 'false'
os.environ['TESCORD_REDIS_URL'] = ''
