"""Offline administrator operations: python -m app.encryption_admin --help.

No keys or decrypted content are printed. Copy the private keyring to offline
storage before enabling encryption. Backups must be encrypted with age to a
separate recovery recipient whose private key is NOT on the application server.
"""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4


def private_write(path: Path, data: bytes, *, replace=False):
    temporary = path.with_name(path.name+'.'+uuid4().hex+'.part')
    if not replace and path.exists():
        raise RuntimeError('Keyring already exists; refusing to overwrite it')
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        if os.name == 'nt':
            os.close(fd)
            fd = None
            subprocess.run(['icacls', str(temporary), '/inheritance:r', '/grant:r',
                            getpass.getuser()+':(F)', '*S-1-5-18:(F)', '/q'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            fd = os.open(temporary, os.O_WRONLY)
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if replace:
            temporary.replace(path)
        else:
            # Hard-link creation fails if another initializer created the path.
            os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def generate_keyring(path: Path, *, rotate=False):
    lock = path.with_name(path.name+'.lock')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        _generate_keyring_locked(path, rotate=rotate)
    finally:
        lock.unlink(missing_ok=True)


def _generate_keyring_locked(path: Path, *, rotate=False):
    raw = json.loads(path.read_text(encoding='utf-8')) if rotate else {'keys':{}}
    if rotate:
        from app.services.data_encryption import _read_keyring
        info = path.stat()
        _read_keyring(str(path), info.st_mtime_ns, info.st_size)
        if len(raw['keys']) >= 32:
            raise RuntimeError('Review retained key usage before adding more keys')
    key_id = uuid4().hex
    raw['active'] = key_id
    raw['keys'][key_id] = base64.b64encode(os.urandom(32)).decode()
    private_write(path, json.dumps(raw).encode(), replace=rotate)


def audit(path: Path, record: dict):
    destination = path.with_name(path.name+'.audit.jsonl')
    line = json.dumps({**record, 'time':datetime.now(timezone.utc).isoformat()}).encode()+b'\n'
    if not destination.exists():
        private_write(destination, line)
    else:
        with destination.open('ab') as output:
            output.write(line)
            output.flush()
            os.fsync(output.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'rotate-key', 'status', 'migrate', 'rotate-data', 'verify'])
    parser.add_argument('--keyring', type=Path, help='Private keyring path, required for init/rotate-key')
    parser.add_argument('--offline', action='store_true', help='Confirm application workers are stopped for data migration')
    args = parser.parse_args()
    try:
        if args.command in {'init', 'rotate-key'}:
            if args.keyring is None:
                parser.error('--keyring is required')
            generate_keyring(args.keyring, rotate=args.command == 'rotate-key')
            audit(args.keyring, {'operation':args.command, 'ok':True})
            print(json.dumps({'operation':args.command, 'ok':True}))
            return
        from app.db.session import SessionLocal
        from app.services.encryption_migration import migrate, status, verify
        with SessionLocal() as db:
            if args.command == 'status':
                result = status(db)
            elif args.command == 'verify':
                result = verify(db)
            else:
                if not args.offline:
                    parser.error('Stop application workers and use --offline before migrating storage')
                from sqlalchemy import text
                # Also prevent two administrators from migrating concurrently.
                if not db.scalar(text('SELECT pg_try_advisory_lock(743190057)')):
                    raise RuntimeError('Another encryption migration is running')
                try:
                    result = migrate(db, rotate=args.command == 'rotate-data')
                finally:
                    db.rollback()
                    db.execute(text('SELECT pg_advisory_unlock(743190057)'))
        from app.core.config import get_settings
        record = {'operation':args.command, 'time':datetime.now(timezone.utc).isoformat(), 'result':result}
        if get_settings().data_keyring_path:
            audit(Path(get_settings().data_keyring_path), record)
        print(json.dumps(record))
    except Exception:
        # Do not include exception repr: parsers/DB drivers can include key material or data.
        parser.exit(1, 'Encryption operation failed. Check configuration and integrity; data was not silently decrypted or discarded.\n')


if __name__ == '__main__':
    main()
