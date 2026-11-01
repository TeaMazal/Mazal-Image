"""只导出源码白名单，生成文件哈希；默认拒绝凭据或生产数据。"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--forbid-value', action='append', default=[], help='Private deployment marker to reject; values are never printed')
args = parser.parse_args()
if not (str(args.output).endswith('.tar.gz') or args.output.suffix.lower() == '.zip'):
    parser.error('--output must end in .tar.gz or .zip')
directories = {'frontend', 'backend', 'deploy', 'docs', 'tests', 'scripts', 'sites', 'licenses', 'integrations', '.github'}
root_files = {'AGENTS.md', 'README.md', 'LICENSE', 'NOTICE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
              'compose.yml', '.env.example', '.gitignore', '.dockerignore', 'VERSION', 'SOURCE.json'}
skip = {'node_modules', 'dist', 'out', '.next', 'target', '__pycache__', '.git', 'state', 'backups', 'artifacts', '.wrangler'}
patterns = [re.compile(p) for p in (
    r'-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----',
    r'\bgh[pousr]_[A-Za-z0-9]{30,}', r'\bgithub_pat_[A-Za-z0-9_]{40,}',
    r'\bsk-[A-Za-z0-9_-]{32,}', r'\bAKIA[A-Z0-9]{16}\b',
)]
files = []
findings = []
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root)
    if relative.parts[:3] in {('integrations', 'canvas', 'workbench'), ('integrations', 'canvas', 'canvas-state')}: continue
    if any(part in skip for part in relative.parts) or path.is_dir(): continue
    if path.is_symlink(): raise SystemExit('Source symlinks are not allowed: ' + str(relative))
    if relative.parts[0] not in directories and str(relative) not in root_files: continue
    if path.name.startswith('.env') and path.name not in ('.env.example', '.env.test'): continue
    if path.suffix in ('.log', '.pyc', '.tsbuildinfo') or path.name == 'dev-proxy.config.json': continue
    if path.suffix in ('.db', '.sqlite', '.pem', '.key') or path.name in ('config.json', 'accounts.json', 'auth_keys.json'):
        findings.append(str(relative)); continue
    data = path.read_bytes()
    text = data.decode('utf-8', errors='ignore') if len(data) < 4 * 1024**2 else ''
    if any(pattern.search(text) for pattern in patterns): findings.append(str(relative))
    if any(value in text for value in args.forbid_value):
        findings.append(str(relative))
    files.append(path)
if findings:
    raise SystemExit('Review possible secrets or private files; values withheld: ' + ', '.join(sorted(set(findings))))
args.output.parent.mkdir(parents=True, exist_ok=True)
if args.output.suffix.lower() == '.zip':
    with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files: archive.write(path, arcname=path.relative_to(root).as_posix())
else:
    with tarfile.open(args.output, 'w:gz') as archive:
        for path in files: archive.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
manifest = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
manifest_path = args.output.with_suffix(args.output.suffix + '.manifest.json')
manifest_path.write_text(json.dumps({'files': manifest, 'archive_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(files), 'bytes': args.output.stat().st_size, 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(), 'possible_secret_findings': 0}))
