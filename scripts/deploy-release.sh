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
previous=$(readlink -f /srv/tescord/current)
runtime_source="${TESCORD_RUNTIME_CONFIG_PATH:-$previous/frontend/dist/frontend/browser/runtime-config.js}"
test -f "$runtime_source"
if grep -Eiq 'credential|username|iceServers' "$runtime_source"; then
    echo 'Prepare a public runtime config without TURN credentials; set TESCORD_RUNTIME_CONFIG_PATH. See docs/security-hardening-2026-11.md.' >&2
    exit 1
fi
if [ -n "${TESCORD_EXPECTED_REVISION:-}" ]; then
    test "$(cat /srv/tescord/current/SOURCE_REVISION)" = "$TESCORD_EXPECTED_REVISION" || {
        echo 'Active revision changed; deployment stopped before migration.' >&2
        exit 1
    }
fi
cd "$release"
sha256sum -c RELEASE.sha256 >/dev/null
python3 "$release/scripts/persist-downloads.py" "$release"
ln -s /srv/tescord/shared/backend.env backend/.env
ln -s /srv/tescord/shared/storage backend/storage
python="${TESCORD_DEPLOY_PYTHON:-python3}"
"$python" -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
"$python" -m venv backend/.venv
backend/.venv/bin/pip install --disable-pip-version-check -q -r backend/requirements.lock
chown -R tescord:tescord "$release"
# Check the configured private keyring before any migration or service switch.
cd "$release/backend"
runuser -u tescord -- .venv/bin/python -c 'from app.services.data_encryption import required_keyring; required_keyring()'
# Always use this release's encrypted backup implementation, even if an older
# installed helper still writes plaintext backups.
bash "$release/scripts/backup-server.sh"
cd "$release/backend"
runuser -u tescord -- .venv/bin/alembic upgrade head
cp "$runtime_source" "$release/frontend/dist/frontend/browser/runtime-config.js"
sha256sum "$release/frontend/dist/frontend/browser/runtime-config.js" > "$release/RUNTIME.sha256"
# Keep immutable bundles referenced by browsers which loaded the previous HTML.
find "$previous/frontend/dist/frontend/browser" -maxdepth 1 -type f \( -name '*-*.js' -o -name '*-*.css' \) -exec cp -n -- {} "$release/frontend/dist/frontend/browser/" \;
# Copies made after chown inherit root ownership and umask 027. Public assets
# must remain readable by nginx, including runtime config and retained bundles.
find "$release/frontend/dist/frontend/browser" -type d -exec chmod 755 {} +
find "$release/frontend/dist/frontend/browser" -type f -exec chmod 644 {} +
rollback() {
    if [ ! -f "$previous/backend/app/services/data_encryption.py" ]; then
        if ! runuser -u tescord -- .venv/bin/python -c '
import sys
from sqlalchemy import text
from app.db.session import engine
with engine.connect() as c:
    encrypted = c.scalar(text("SELECT EXISTS(SELECT 1 FROM messages WHERE encrypted_content IS NOT NULL) OR EXISTS(SELECT 1 FROM room_messages WHERE encrypted_content IS NOT NULL) OR EXISTS(SELECT 1 FROM room_uploads WHERE storage_encrypted) OR EXISTS(SELECT 1 FROM attachments WHERE storage_path LIKE :suffix) OR EXISTS(SELECT 1 FROM pending_uploads WHERE storage_path LIKE :suffix)"), {"suffix":"%.kvaenc"})
sys.exit(1 if encrypted else 0)
'; then
            echo 'Automatic rollback refused: encrypted data requires a compatible backend. Keep the current release and repair it, or restore the verified encrypted backup during maintenance.' >&2
            return 1
        fi
    fi
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
curl --fail --silent --max-time 15 --resolve kvachat.ru:443:127.0.0.1 https://kvachat.ru/runtime-config.js >/dev/null
trap - ERR
install -m 0755 "$release/scripts/backup-server.sh" /usr/local/sbin/kva-backup
if [ "${TESCORD_PRUNE_RELEASES:-false}" = true ] && [ -f "$release/scripts/prune-releases.py" ]; then
    python3 "$release/scripts/prune-releases.py" "$previous" --apply || echo 'Release cleanup failed; check disk space.' >&2
elif [ "${TESCORD_PRUNE_RELEASES:-false}" = true ] && [ -f /usr/local/sbin/kva-prune-releases ]; then
    python3 /usr/local/sbin/kva-prune-releases "$previous" --apply || echo 'Release cleanup failed; check disk space.' >&2
fi
echo "Active release: $release"
