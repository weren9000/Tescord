"""Start a disposable local LiveKit and test 30 browser audio publishers.

Usage: backend/.venv/Scripts/python scripts/voice-media-smoke.py --server PATH
PATH is a local LiveKit server binary. No production credentials are used.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

from livekit import api

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--server', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
stage = root / '.local' / ('voice-media-' + str(time.time_ns()))
stage.mkdir(parents=True)
key, secret = 'isolated-test', secrets.token_hex(32)
config, plan = stage / 'server.yaml', stage / 'clients.json'
config.write_text('port: 27880\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: 27881\n  udp_port: 27882\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  isolated-test: ' + secret + '\n')


async def prepare():
    async with api.LiveKitAPI('http://127.0.0.1:27880', key, secret) as client:
        await client.room.create_room(api.CreateRoomRequest(name='browser-audio-test', max_participants=30, empty_timeout=60))


with (stage / 'server.log').open('w') as log:
    server = subprocess.Popen([str(args.server.resolve()), '--config', str(config)], stdout=log, stderr=log,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        time.sleep(2)
        if server.poll() is not None:
            raise RuntimeError(f'Test server failed to start; see {stage / "server.log"}')
        asyncio.run(prepare())
        tokens = [api.AccessToken(key, secret).with_identity(str(i)).with_grants(api.VideoGrants(
            room_join=True, room='browser-audio-test', can_publish=True, can_subscribe=True)).to_jwt() for i in range(32)]
        plan.write_text(json.dumps(dict(url='ws://127.0.0.1:27880', tokens=tokens)))
        result = stage / 'result.json'
        env = dict(os.environ, VOICE_TEST_CONFIG=str(plan), VOICE_TEST_RESULT=str(result))
        subprocess.run(['node', str(root / 'scripts/voice-browser-load.cjs')], cwd=root, env=env, timeout=180, check=True)
        print('Verified media report:', result)
    finally:
        server.terminate()
        server.wait(timeout=15)
        config.unlink(missing_ok=True)
        plan.unlink(missing_ok=True)
