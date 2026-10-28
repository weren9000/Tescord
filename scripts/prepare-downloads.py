"""Stage existing signed installers locally. Never uploads or changes a server."""
from pathlib import Path
import hashlib
import shutil
import json

root = Path(__file__).resolve().parents[1]
target = root / 'frontend/public/downloads'
target.mkdir(exist_ok=True)
desktop_version = json.loads((root / 'desktop/package.json').read_text(encoding='utf-8'))['version']
android_version = json.loads((root / 'mobile/package.json').read_text(encoding='utf-8'))['version']
files = [root / f'desktop/release/KvaChat-Setup-{desktop_version}-x64.exe',
         root / f'mobile/release/KvaChat-{android_version}-android.apk']
for source in files:
    if not source.is_file(): raise SystemExit(f'Missing installer: {source}')
    checksum = source.with_suffix(source.suffix + '.sha256')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if not checksum.is_file() or checksum.read_text().split()[0].lower() != digest:
        raise SystemExit(f'Checksum mismatch: {source.name}')
    shutil.copy2(source, target / source.name)
    (target / checksum.name).write_text(f'{digest}  {source.name}\n', encoding='ascii', newline='\n')
    # Native packages are built after the web UI. Refresh its staged downloads
    # without rebuilding that UI (which would otherwise create a packaging cycle).
    build = root / 'frontend/dist/frontend/browser'
    if (build / 'index.html').is_file():
        staged = build / 'downloads'
        staged.mkdir(exist_ok=True)
        shutil.copy2(target / source.name, staged / source.name)
        shutil.copy2(target / checksum.name, staged / checksum.name)
    print(f'{source.name}: {source.stat().st_size} bytes, verified')
