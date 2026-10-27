"""Add meeting entry routes to the existing self-hosted nginx site.

Run on the server before activating the release, then nginx -t and reload.
Keeps a first-run backup; does not restart any services itself.
"""
from pathlib import Path
import sys

site = Path(sys.argv[1] if len(sys.argv) > 1 else '/etc/nginx/sites-available/kvachat')
original = site.read_text()
updated = original
if 'my-room' not in updated:
    needle = 'channels/[a-zA-Z0-9-]+/[a-zA-Z0-9-]+|invite/'
    if needle not in updated:
        raise SystemExit('Unexpected nginx routing configuration; inspect before changing it')
    updated = updated.replace(needle, 'my-room|room/[A-Za-z0-9_-]+|'+needle)
    updated = updated.replace('login|channels|invite|', 'login|my-room|room|channels|invite|')
if '$kva_safe_uri' not in updated:
    updated = """map $uri $kva_safe_uri {
    default $uri;
    ~^/room/ "/room/[invite]";
    ~^/api/rooms/invite/ "/api/rooms/invite/[invite]";
}
""" + updated.replace('$request_method $uri $server_protocol', '$request_method $kva_safe_uri $server_protocol')
if updated != original:
    backup = site.with_name(site.name+'.before-meetings')
    if not backup.exists():
        backup.write_text(original)
    site.write_text(updated)
    print('Meeting routes and invitation log redaction configured')
else:
    print('Meeting nginx configuration is already current')
