"""Package only committed Islands runtime and installation files, never art sources or tests."""
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[3]
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit reviewed changes before packaging Islands')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / f'islands-{revision}.tar.gz'
prefix = 'plugins/islands/'
allowed = {'pyproject.toml', 'requirements.lock', 'DEPLOYMENT.md', 'scripts/create-grant-key.py',
           'web/play.html', 'web/game.mjs', 'web/game-board.mjs', 'web/game.css',
           'web/connection.mjs', 'web/palette.css', 'web/cosmic.css',
           'web/cosmic-panel.webp', 'web/cosmic-logo.webp',
           'web/cosmic-button-primary.webp', 'web/cosmic-button-danger.webp'}
source = subprocess.check_output(['git', '-c', 'core.autocrlf=false', 'archive', '--format=tar', 'HEAD', prefix], cwd=root)
checksums = []
with tarfile.open(output, 'w:gz') as target:
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        for entry in archive:
            if not entry.isfile() or not entry.name.startswith(prefix):
                continue
            name = entry.name[len(prefix):]
            if not (name in allowed or name.startswith(('islands/', 'deploy/', 'web/assets/'))):
                continue
            if '__pycache__' in name or name.endswith(('.pyc', '.png')):
                raise SystemExit('Unexpected runtime artifact: ' + name)
            content = archive.extractfile(entry).read()
            entry.name = name
            target.addfile(entry, io.BytesIO(content))
            checksums.append((name, hashlib.sha256(content).hexdigest()))
    for name, content in [('SOURCE_REVISION', revision + '\n'), ('RELEASE.sha256', ''.join(f'{digest}  {name}\n' for name, digest in checksums))]:
        data = content.encode()
        entry = tarfile.TarInfo(name)
        entry.size = len(data)
        target.addfile(entry, io.BytesIO(data))
print(f'{output}\nSHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}\nFiles {len(checksums)}')
