"""Slow image delivery must not starve DB connections or block the event loop."""
import asyncio
from uuid import UUID
import httpx
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.api.routes import users as user_routes, inventory as inventory_routes
from app.api.routes.servers import list_server_voice_presence
from app.db.models import User
from app.db.session import engine, SessionLocal
from app.core.config import get_settings
from test_inventory import accounts


def test_image_connections_released_before_slow_send(accounts):
    _, people = accounts
    application = FastAPI()
    application.include_router(user_routes.router, prefix='/api')
    application.include_router(inventory_routes.router, prefix='/api')

    async def check():
        baseline = engine.pool.checkedout()
        reached = 0
        ready = asyncio.Event()
        release = asyncio.Event()
        async def slow_send_app(scope, receive, send):
            async def delayed(message):
                nonlocal reached
                if message['type'] == 'http.response.start':
                    assert message['status'] == 200
                    reached += 1
                    if reached == 4: ready.set()
                    await release.wait()
                await send(message)
            await application(scope, receive, delayed)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=slow_send_app), base_url='http://testserver') as c:
            paths=['/api/users/'+people[0][1]['id']+'/avatar', '/api/inventory/assets/cyber-oni']*2
            tasks=[asyncio.create_task(c.get(path)) for path in paths]
            try:
                await asyncio.wait_for(ready.wait(), 5)
                assert engine.pool.checkedout() == baseline
            finally:
                release.set()
                await asyncio.gather(*tasks)
    asyncio.run(check())


def test_voice_presence_pool_wait_does_not_block_event_loop(accounts):
    c, people = accounts
    headers, person, _ = people[0]
    response=c.post('/api/conversations/group',headers=headers,json={'name':'Pool test','member_ids':[]})
    assert response.status_code==201 or response.status_code==200
    server_id=UUID(response.json()['id'])
    with SessionLocal() as db:
        user=db.get(User,UUID(person['id']));db.expunge(user)
    small=create_engine(get_settings().database_url, pool_size=1, max_overflow=0, pool_timeout=.3)
    async def check():
        occupied=small.connect()
        async def release():
            await asyncio.sleep(.05)
            occupied.close()
        release_task=asyncio.create_task(release())
        try:
            with Session(small) as db:
                assert await list_server_voice_presence(server_id,user,db)==[]
                assert small.pool.checkedout()==0
        finally:
            await release_task
            occupied.close()
    try: asyncio.run(check())
    finally: small.dispose()
