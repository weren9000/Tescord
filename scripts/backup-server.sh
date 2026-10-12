#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/srv/tescord
exec 9>/run/lock/kva-backup.lock
flock -w 300 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$base/backups/daily-$stamp"
mkdir -p "$backup"
runuser -u postgres -- pg_dump --format=custom tescord > "$backup/database.dump"
# Preserve files before pruning anything. User uploads live outside release directories.
storage="$base/shared/storage"
if [ ! -d "$storage" ]; then storage="$base/app/backend/storage"; fi
tar -czf "$backup/storage.tar.gz" -C "$storage" .
tar -czf "$backup/config.tar.gz" --exclude='*.log' -C / \
    etc/nginx etc/livekit etc/systemd/system/tescord-backend.service \
    etc/systemd/system/tescord-backend.service.d \
    srv/tescord/shared/backend.env
if [ -L "$base/current" ]; then readlink -f "$base/current" > "$backup/release.txt"; fi
cd "$backup"
sha256sum database.dump storage.tar.gz config.tar.gz > SHA256SUMS
sha256sum -c SHA256SUMS >/dev/null
touch COMPLETE
ln -sfn "$backup" "$base/backups/latest.new"
mv -Tf "$base/backups/latest.new" "$base/backups/latest"
# Retain 14 days of completed daily backups; never touch pre-deployment backups.
find "$base/backups" -mindepth 1 -maxdepth 1 -type d -name 'daily-*' -mtime +14 -exec test -f '{}/COMPLETE' \; -exec rm -rf -- {} +
printf '%s\n' "$backup"
