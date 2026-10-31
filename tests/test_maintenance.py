import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'backend/maintenance.py'
if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1].endswith('.py'):
    source = Path(sys.argv.pop(1))
spec = importlib.util.spec_from_file_location('maintenance', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MaintenanceTests(unittest.TestCase):
    def test_expiry_capacity_and_database_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            images = root / 'data/images'
            images.mkdir(parents=True)
            old, oldest, newest = [images / x for x in ['expired.png', 'old.png', 'new.png']]
            for p in [old, oldest, newest]:
                p.write_bytes(b'x' * 6)
            os.utime(old, (time.time()-400000, time.time()-400000))
            os.utime(oldest, (time.time()-60, time.time()-60))
            database = root / 'data/accounts.db'
            database.write_text('must remain')
            with patch.object(module, 'ROOT', root), patch.object(module, 'MEDIA_LIMIT', 8):
                module.cleanup()
            self.assertFalse(old.exists())
            self.assertFalse(oldest.exists())
            self.assertTrue(newest.exists())
            self.assertEqual(database.read_text(), 'must remain')

    def test_backup_uses_consistent_database_and_excludes_media(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'storage'
            (root / 'data/images').mkdir(parents=True)
            (root / 'config.json').write_text('{"test": true}')
            (root / 'data/images/picture.png').write_bytes(b'image')
            with sqlite3.connect(root / 'data/accounts.db') as c:
                c.execute('CREATE TABLE test (value TEXT)')
                c.execute("INSERT INTO test VALUES ('preserved')")
            target = Path(folder) / 'backups'
            with patch.object(module, 'ROOT', root), patch.object(module, 'BACKUPS', target):
                module.backup()
                module.backup()
            archives = list(target.glob('settings-*.tar.gz'))
            self.assertEqual(len(archives), 1)
            with tarfile.open(archives[0]) as archive:
                self.assertEqual(sorted(archive.getnames()), ['accounts.db', 'config.json'])
                database = Path(folder) / 'restored.db'
                database.write_bytes(archive.extractfile('accounts.db').read())
            with sqlite3.connect(database) as c:
                self.assertEqual(c.execute('SELECT value FROM test').fetchone()[0], 'preserved')
            self.assertEqual(list(target.glob('.pending-*')), [])

    def test_backup_rotation_keeps_only_configured_count(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'storage'
            (root / 'data').mkdir(parents=True)
            (root / 'config.json').write_text('{}')
            target = Path(folder) / 'backups'
            target.mkdir()
            for day in range(1, 5):
                (target / f'settings-2000010{day}.tar.gz').write_bytes(b'old backup')
            with patch.object(module, 'ROOT', root), patch.object(module, 'BACKUPS', target), patch.object(module, 'BACKUP_KEEP', 3):
                module.backup()
            archives = sorted(p.name for p in target.glob('settings-*.tar.gz'))
            self.assertEqual(len(archives), 3)
            self.assertNotIn('settings-20000101.tar.gz', archives)
            self.assertNotIn('settings-20000102.tar.gz', archives)
            self.assertEqual(list(target.glob('.backup-work-*')), [])

    def test_oversized_sources_are_skipped_without_temporary_copies(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'storage'
            (root / 'data').mkdir(parents=True)
            (root / 'config.json').write_text('x' * 4096)
            target = Path(folder) / 'backups'
            before = module.resource.getrlimit(module.resource.RLIMIT_FSIZE)
            with patch.object(module, 'ROOT', root), patch.object(module, 'BACKUPS', target), patch.object(module, 'BACKUP_LIMIT', 2048):
                module.backup()
            self.assertEqual(list(target.iterdir()), [])
            self.assertEqual(module.resource.getrlimit(module.resource.RLIMIT_FSIZE), before)
            self.assertEqual((root / 'config.json').stat().st_size, 4096)


if __name__ == '__main__':
    unittest.main(verbosity=2)
