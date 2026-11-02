#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/srv/tescord
recipients=${TESCORD_BACKUP_RECIPIENTS_FILE:-/etc/tescord/backup-recipients.txt}
command -v age >/dev/null || { printf 'age is required for encrypted backups\n' >&2; exit 1; }
test -s "$recipients" || { printf 'Configure the offline recovery recipient before backing up\n' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
keyring_helper="$script_dir/backup-keyring-path.py"
if [ ! -f "$keyring_helper" ]; then keyring_helper="$base/current/scripts/backup-keyring-path.py"; fi
keyring=$("$base/current/backend/.venv/bin/python" "$keyring_helper")
test -s "/$keyring"
# Validate public recipients before starting the database dump. Private recovery
# identities belong offline and are never installed on this server.
printf '' | age -R "$recipients" >/dev/null
exec 9>/run/lock/kva-backup.lock
flock -w 300 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$base/backups/daily-$stamp"
mkdir -p "$backup"
runuser -u postgres -- pg_dump --format=custom --exclude-table-data='public.room_*' --exclude-table-data='public.secret_*' tescord | age -R "$recipients" > "$backup/database.dump.age"
# Preserve files before pruning anything. User uploads live outside release directories.
storage="$base/shared/storage"
if [ ! -d "$storage" ]; then storage="$base/app/backend/storage"; fi
tar -cz --exclude='./meeting-files' --exclude='./uploads/secret' -C "$storage" . | age -R "$recipients" > "$backup/storage.tar.gz.age"
configs=(etc/nginx etc/systemd/system/tescord-backend.service srv/tescord/shared/backend.env "$keyring")
for optional in etc/livekit etc/systemd/system/tescord-backend.service.d etc/tescord/data-keys; do
    if [ -e "/$optional" ]; then configs+=("$optional"); fi
done
tar -cz --exclude='*.log' -C / "${configs[@]}" | age -R "$recipients" > "$backup/config.tar.gz.age"
if [ -L "$base/current" ]; then readlink -f "$base/current" > "$backup/release.txt"; fi
cd "$backup"
sha256sum database.dump.age storage.tar.gz.age config.tar.gz.age > SHA256SUMS
sha256sum -c SHA256SUMS >/dev/null
touch COMPLETE
ln -sfn "$backup" "$base/backups/latest.new"
mv -Tf "$base/backups/latest.new" "$base/backups/latest"
# Retain 14 days of completed daily backups; never touch pre-deployment backups.
find "$base/backups" -mindepth 1 -maxdepth 1 -type d -name 'daily-*' -mtime +14 -exec test -f '{}/COMPLETE' \; -exec rm -rf -- {} +
printf '%s\n' "$backup"
