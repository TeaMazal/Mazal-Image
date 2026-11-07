"""Apply only to the reviewed Sub2 baseline, never overwrite another release."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--backend', type=Path, required=True)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent
backend = args.backend.resolve()
manifest = json.loads((root / 'backend-manifest.json').read_text())

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

if all(digest(backend / name) == item['after'] for name, item in manifest.items()):
    print('This integration is already applied.')
    raise SystemExit(0)
for name, item in manifest.items():
    if digest(backend / name) != item['before']:
        raise SystemExit('Baseline differs; review and merge before applying: ' + name)
patch = str(root / 'backend.patch')
subprocess.run(['git', 'apply', '--check', patch], cwd=backend, check=True)
if args.apply:
    subprocess.run(['git', 'apply', patch], cwd=backend, check=True)
    # Unified diffs cannot represent creation of a zero-byte package marker.
    for name, item in manifest.items():
        if item['before'] is None and item['after'] == hashlib.sha256(b'').hexdigest():
            target = backend / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch(exist_ok=True)
    for name, item in manifest.items():
        assert digest(backend / name) == item['after'], name
    print('Applied and verified. No deployment or database changes performed.')
else:
    print('Baseline verified. Use --apply to update this checkout.')
