#!/usr/bin/env python3
"""Keep the active release and the explicitly supplied rollback release."""
import argparse
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('previous')
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
base = Path('/srv/tescord/releases').resolve()
keep = {Path('/srv/tescord/current').resolve(), Path(args.previous).resolve()}
for path in keep:
    assert path.parent == base and path.is_dir(), path
    assert (path / 'SOURCE_REVISION').read_text().strip() == path.name, path
for path in base.iterdir():
    if path.is_symlink() or path.resolve().parent != base or path in keep:
        continue
    if path.is_dir() and re.fullmatch(r'[0-9a-f]{40}', path.name):
        if not (path / 'SOURCE_REVISION').is_file():
            continue
        assert (path / 'SOURCE_REVISION').read_text().strip() == path.name, path
        print('Remove old release:', path.name)
        if args.apply:
            shutil.rmtree(path)
    elif path.is_file() and re.fullmatch(r'kva-[0-9a-f]{8,40}\.tar\.gz', path.name):
        if any(p.name in path.name for p in keep):
            continue
        print('Remove old archive:', path.name)
        if args.apply:
            path.unlink()
