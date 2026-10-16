#!/usr/bin/env bash
set -euo pipefail
umask 027
# Usage: deploy-release.sh /srv/tescord/releases/<git-sha>
release=$(realpath "${1:?Release directory required}")
case "$release" in /srv/tescord/releases/*) ;; *) echo 'Release outside allowed directory' >&2; exit 1 ;; esac
test -f "$release/backend/requirements.lock"
test -f "$release/frontend/dist/frontend/browser/index.html"
test -f /srv/tescord/shared/backend.env
test -d /srv/tescord/shared/storage
available=$(df --output=avail -B1 /srv/tescord | tail -1)
if [ "$available" -lt 1073741824 ]; then
    echo 'Deployment requires at least 1 GiB of free space.' >&2
    exit 1
fi
exec 9>/run/lock/kva-deploy.lock
flock -n 9
cd "$release"
sha256sum -c RELEASE.sha256 >/dev/null
python3 "$release/scripts/persist-downloads.py" "$release"
ln -s /srv/tescord/shared/backend.env backend/.env
ln -s /srv/tescord/shared/storage backend/storage
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install --disable-pip-version-check -q -r backend/requirements.lock
chown -R tescord:tescord "$release"
/usr/local/sbin/kva-backup >/dev/null
cd "$release/backend"
runuser -u tescord -- .venv/bin/alembic upgrade head
previous=$(readlink -f /srv/tescord/current)
cp "$previous/frontend/dist/frontend/browser/runtime-config.js" "$release/frontend/dist/frontend/browser/runtime-config.js"
sha256sum "$release/frontend/dist/frontend/browser/runtime-config.js" > "$release/RUNTIME.sha256"
# Keep immutable bundles referenced by browsers which loaded the previous HTML.
find "$previous/frontend/dist/frontend/browser" -maxdepth 1 -type f \( -name '*-*.js' -o -name '*-*.css' \) -exec cp -n -- {} "$release/frontend/dist/frontend/browser/" \;
rollback() {
    ln -sfn "$previous" /srv/tescord/current.next
    mv -Tf /srv/tescord/current.next /srv/tescord/current
    systemctl restart tescord-backend
    echo "Release failed; restored $previous. Additive database migration retained." >&2
}
ln -sfn "$release" /srv/tescord/current.next
mv -Tf /srv/tescord/current.next /srv/tescord/current
trap rollback ERR
systemctl restart tescord-backend
healthy=false
for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 2 -H 'Host: kvachat.ru' http://127.0.0.1:8000/api/health >/dev/null; then healthy=true; break; fi
    sleep 1
done
test "$healthy" = true
nginx -t
systemctl reload nginx
trap - ERR
if [ -f "$release/scripts/prune-releases.py" ]; then
    python3 "$release/scripts/prune-releases.py" "$previous" --apply || echo 'Release cleanup failed; check disk space.' >&2
elif [ -f /usr/local/sbin/kva-prune-releases ]; then
    python3 /usr/local/sbin/kva-prune-releases "$previous" --apply || echo 'Release cleanup failed; check disk space.' >&2
fi
echo "Active release: $release"
