"""Run during deployment after release checksums pass; keep versioned installers across releases."""
import hashlib
import os
from pathlib import Path
import shutil
import sys

def persist(source: Path, destination: Path):
    if source.is_symlink():
        if source.resolve() != destination.resolve(): raise ValueError('Unexpected downloads symlink')
        return
    destination.mkdir(parents=True, exist_ok=True)
    destination.chmod(0o755)
    files = list(source.iterdir()) if source.exists() else []
    for file in files:
        if not file.is_file() or file.suffix not in ('.exe', '.apk', '.sha256'): raise ValueError(f'Unexpected download: {file.name}')
        if file.suffix == '.sha256': continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        if file.with_suffix(file.suffix + '.sha256').read_text().split()[0].lower() != digest: raise ValueError(f'Checksum mismatch: {file.name}')
    for file in files:
        target = destination / file.name
        if target.exists():
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(file.read_bytes()).digest(): raise ValueError(f'Cannot replace immutable download: {file.name}')
        else:
            temporary = target.with_name(target.name + '.tmp')
            shutil.copyfile(file, temporary)
            temporary.chmod(0o644)
            os.replace(temporary, target)
    for file in files: file.unlink()
    if source.exists(): source.rmdir()
    source.symlink_to(destination, target_is_directory=True)

if __name__ == '__main__':
    release = Path(sys.argv[1]).resolve()
    if release.parent != Path('/srv/tescord/releases'): raise SystemExit('Release outside deployment directory')
    persist(release / 'frontend/dist/frontend/browser/downloads', Path('/srv/tescord/shared/downloads'))
