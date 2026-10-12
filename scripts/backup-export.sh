#!/usr/bin/env bash
set -euo pipefail
# Restricted SSH key may execute only this command, with no shell or forwarding.
/usr/local/sbin/kva-backup >/dev/null
backup=$(readlink -f /srv/tescord/backups/latest)
case "$backup" in /srv/tescord/backups/daily-*) ;; *) exit 1 ;; esac
test -f "$backup/COMPLETE"
tar -cf - -C "$backup" .
