"""Keep expendable media bounded; back up only configuration and account state."""
import datetime
import argparse
import fcntl
import json
import os
from pathlib import Path
import resource
import shutil
import sqlite3
import tarfile
import tempfile
import time

ROOT = Path(os.environ.get('MI_STATE_DIR', '/state'))
BACKUPS = Path(os.environ.get('MI_BACKUP_DIR', '/backups'))
MEDIA_LIMIT = max(1, int(os.environ.get('MI_MEDIA_LIMIT_MB', '1024'))) * 1024**2
AGE_SECONDS = max(1, int(os.environ.get('MI_MEDIA_MAX_AGE_HOURS', '72'))) * 3600
BACKUP_LIMIT = max(1, int(os.environ.get('MI_BACKUP_LIMIT_MB', '32'))) * 1024**2
BACKUP_KEEP = max(1, int(os.environ.get('MI_BACKUP_KEEP', '3')))
MIN_FREE = max(32, int(os.environ.get('MI_MIN_FREE_MB', '512'))) * 1024**2


def media_files():
    result = []
    for folder in ('images', 'image_thumbnails', 'files'):
        path = ROOT / 'data' / folder
        if path.exists():
            result.extend(p for p in path.rglob('*') if p.is_file() and not p.is_symlink())
    return result


def cleanup():
    removed = 0
    now = time.time()
    for path in media_files():
        try:
            if now - path.stat().st_mtime > AGE_SECONDS:
                path.unlink()
                removed += 1
        except FileNotFoundError:
            pass
    files = sorted(media_files(), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    for path in files:
        if total <= MEDIA_LIMIT and shutil.disk_usage(ROOT).free >= MIN_FREE:
            break
        n = path.stat().st_size
        path.unlink(missing_ok=True)
        total -= n
        removed += 1
    # JSONL request logs are expendable; truncation preserves the writer's inode.
    for path in (ROOT / 'data').rglob('*.jsonl'):
        if not path.is_symlink() and path.stat().st_size > 10 * 1024**2:
            with path.open('r+b') as stream:
                stream.seek(-5 * 1024**2, os.SEEK_END)
                stream.readline()
                tail = stream.read()
                stream.seek(0)
                stream.write(tail)
                stream.truncate()
    print('Media cleanup: removed=' + str(removed) + '; media_bytes=' + str(total), flush=True)


def backup():
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d')
    target = BACKUPS / ('settings-' + stamp + '.tar.gz')
    if target.exists():
        return
    # These limits bound temporary copies and archives; images and logs are excluded.
    previous_limits = resource.getrlimit(resource.RLIMIT_FSIZE)
    resource.setrlimit(resource.RLIMIT_FSIZE, (BACKUP_LIMIT, previous_limits[1]))
    for old in BACKUPS.glob('.pending-*'):
        if old.is_file() and not old.is_symlink():
            old.unlink()
    if shutil.disk_usage(BACKUPS).free < MIN_FREE + BACKUP_LIMIT:
        resource.setrlimit(resource.RLIMIT_FSIZE, previous_limits)
        print('Configuration backup skipped: low disk space', flush=True)
        return
    temporary = BACKUPS / ('.pending-' + stamp + '.tar.gz')
    try:
        sources = [ROOT / 'config.json'] + [ROOT / 'data' / name for name in
            ('accounts.db', 'accounts.json', 'auth_keys.json', 'sub2api_config.json', 'cpa_config.json')]
        if any(p.is_symlink() for p in sources) or sum(p.stat().st_size for p in sources if p.is_file()) > BACKUP_LIMIT:
            print('Configuration backup skipped: sources exceed backup limit or contain symlinks', flush=True)
            return
        with tempfile.TemporaryDirectory(prefix='.backup-work-', dir=BACKUPS) as work:
            stage = Path(work)
            shutil.copyfile(ROOT / 'config.json', stage / 'config.json')
            for name in ('accounts.db',):
                source = ROOT / 'data' / name
                if source.exists():
                    with sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True) as a:
                        with sqlite3.connect(stage / name) as b:
                            a.backup(b)
                            if b.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                                raise RuntimeError('Account database integrity check failed')
            for name in ('accounts.json', 'auth_keys.json', 'sub2api_config.json', 'cpa_config.json'):
                source = ROOT / 'data' / name
                if source.exists() and not source.is_symlink():
                    shutil.copyfile(source, stage / name)
            with tarfile.open(temporary, 'w:gz') as archive:
                for source in stage.iterdir():
                    archive.add(source, arcname=source.name, recursive=False)
            with tarfile.open(temporary, 'r:gz') as archive:
                for entry in archive:
                    if entry.isfile():
                        with archive.extractfile(entry) as stream:
                            while stream.read(65536):
                                pass
        temporary.replace(target)
        for old in sorted(BACKUPS.glob('settings-????????.tar.gz'))[:-BACKUP_KEEP]:
            if old.is_file() and not old.is_symlink():
                old.unlink()
        print('Configuration backup completed: ' + target.name, flush=True)
    finally:
        temporary.unlink(missing_ok=True)
        resource.setrlimit(resource.RLIMIT_FSIZE, previous_limits)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--loop', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if not (ROOT / 'config.json').is_file() or not (ROOT / 'data').is_dir():
        raise SystemExit('State directory is not initialized')
    while True:
        with (ROOT / '.maintenance.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            cleanup()
            try:
                backup()
            except (OSError, sqlite3.Error) as error:
                print('Configuration backup skipped:', type(error).__name__, flush=True)
        if not args.loop:
            break
        time.sleep(60)
