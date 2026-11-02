"""Explicit loopback-only browser fixture. Never import this from production.

Creates an ephemeral game DB and signing key, with four fictional accounts.
The fixture authentication endpoints exist only in this test process.
"""
import argparse
import base64
import json
from pathlib import Path
import tempfile
import time
from uuid import UUID, uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
import uvicorn

from islands.api import Config, create_app


def fixture(port, database):
    key = Ed25519PrivateKey.generate()
    app = create_app(Config(database, key.public_key(), (f'http://127.0.0.1:{port}', 'https://localhost', 'https://kvachat.ru')))
    router = APIRouter()
    users = [{'uid': str(UUID(int=100+i)), 'nick': ['Аня', 'Борис', 'Вера', 'Глеб'][i]} for i in range(4)]

    @router.get('/_test/grant/{index}')
    def grant(index: int):
        if not 0 <= index < len(users):
            raise HTTPException(404)
        now = int(time.time())
        claims = {'iss': 'kvachat', 'aud': 'islands', 'sub': users[index]['uid'],
                  'nick': users[index]['nick'], 'iat': now, 'exp': now+60, 'jti': str(uuid4())}
        encode = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=').decode()
        payload = encode(json.dumps(claims).encode())
        return {'grant': payload+'.'+encode(key.sign(payload.encode()))}

    @router.get('/_test/')
    def parent():
        return HTMLResponse('''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Локальная проверка Островов</title><link rel="stylesheet" href="/_test/fixture.css"></head><body><header>Локальная проверка · вымышленные игроки · данные не сохраняются после остановки</header><iframe src="/play.html" title="Острова"></iframe><script src="/_test/fixture.js"></script></body></html>''')

    @router.get('/_test/fixture.css')
    def style():
        return Response('body{margin:0;background:#10111b;color:#ddd;font:12px system-ui;height:100dvh;display:flex;flex-direction:column}header{padding:8px}iframe{flex:1;width:100%;border:0;min-height:0}', media_type='text/css')

    @router.get('/_test/fixture.js')
    def script():
        return Response('''const frame=document.querySelector('iframe');let busy=false;async function grant(){if(busy)return;busy=true;try{const index=new URLSearchParams(location.search).get('player')||'0';const data=await fetch('/_test/grant/'+encodeURIComponent(index)).then(r=>r.json());frame.contentWindow.postMessage({type:'islands:grant',grant:data.grant},location.origin);}finally{busy=false;}}window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin===location.origin&&e.data?.type==='islands:ready')grant();});setInterval(grant,40000);''', media_type='application/javascript')

    # StaticFiles is mounted last by create_app; put test routes before it.
    static = app.router.routes.pop()
    app.include_router(router)
    app.router.routes.append(static)
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4229)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='islands-browser-') as directory:
        app = fixture(args.port, str(Path(directory)/'fixture.sqlite3'))
        uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning', access_log=False, ws_max_size=2048)
