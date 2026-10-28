"""Package committed source and the production frontend build for deploy-release.sh."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[1]
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit reviewed source changes before packaging a release')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / f'kva-{revision}.tar.gz'
build = root / 'frontend/dist/frontend/browser'
if not (build / 'index.html').is_file():
    raise SystemExit('Run npm ci and npm run build in frontend first')
import re
downloads = set(re.findall(r'href="(/downloads/[^"?]+)"', (build / 'index.html').read_text(encoding='utf-8')))
desktop_version = json.loads((root / 'desktop/package.json').read_text(encoding='utf-8'))['version']
android_version = json.loads((root / 'mobile/package.json').read_text(encoding='utf-8'))['version']
expected_downloads = {
    f'/downloads/KvaChat-Setup-{desktop_version}-x64.exe',
    f'/downloads/KvaChat-{android_version}-android.apk',
}
if not expected_downloads.issubset(downloads):
    raise SystemExit('Landing download versions do not match package versions. Update landing links and rebuild frontend.')
for download in downloads:
    if not (build / download.lstrip('/')).is_file():
        raise SystemExit('Missing landing download. Run scripts/prepare-downloads.py, then rebuild frontend: ' + download)
    staged = build / download.lstrip('/')
    public = root / 'frontend/public' / download.lstrip('/')
    if not public.is_file() or hashlib.sha256(staged.read_bytes()).digest() != hashlib.sha256(public.read_bytes()).digest():
        raise SystemExit('Stale staged download. Run scripts/prepare-downloads.py: ' + download)
source = subprocess.check_output(['git', '-c', 'core.autocrlf=false', 'archive', '--format=tar', 'HEAD'], cwd=root)
checksums = []
with tarfile.open(output, 'w:gz') as target:
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        for entry in archive:
            if not entry.isfile():
                continue
            content = archive.extractfile(entry).read()
            target.addfile(entry, io.BytesIO(content))
            checksums.append((entry.name, hashlib.sha256(content).hexdigest()))
    for path in sorted(build.rglob('*')):
        if path.is_file():
            relative = path.relative_to(build).as_posix()
            if relative.startswith('downloads/') and '/' + relative not in downloads:
                continue  # Old installers remain in the server's immutable download store.
            name = path.relative_to(root).as_posix()
            target.add(path, arcname=name)
            checksums.append((name, hashlib.sha256(path.read_bytes()).hexdigest()))
    for name, content in [('SOURCE_REVISION', revision + '\n'), ('RELEASE.sha256', ''.join(f'{digest}  {name}\n' for name, digest in checksums))]:
        data = content.encode()
        entry = tarfile.TarInfo(name)
        entry.size = len(data)
        target.addfile(entry, io.BytesIO(data))
print(f'{output}\nSHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}')
