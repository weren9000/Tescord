"""Stage existing signed installers locally. Never uploads or changes a server."""
from pathlib import Path
import hashlib
import shutil

root = Path(__file__).resolve().parents[1]
target = root / 'frontend/public/downloads'
target.mkdir(exist_ok=True)
files = [root / 'desktop/release/KvaChat-Setup-0.3.1-x64.exe', root / 'mobile/release/KvaChat-0.1.1-android.apk']
for source in files:
    if not source.is_file(): raise SystemExit(f'Missing installer: {source}')
    checksum = source.with_suffix(source.suffix + '.sha256')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if not checksum.is_file() or checksum.read_text().split()[0].lower() != digest:
        raise SystemExit(f'Checksum mismatch: {source.name}')
    shutil.copy2(source, target / source.name)
    (target / checksum.name).write_text(f'{digest}  {source.name}\n', encoding='ascii', newline='\n')
    print(f'{source.name}: {source.stat().st_size} bytes, verified')
