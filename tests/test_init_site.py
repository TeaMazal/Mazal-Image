import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

source = Path(__file__).resolve().parents[1]


class InitializationTests(unittest.TestCase):
    def prepare(self, base, name):
        root = base / name
        (root / 'scripts').mkdir(parents=True)
        (root / 'backend').mkdir()
        shutil.copyfile(source / 'scripts/init_site.py', root / 'scripts/init_site.py')
        shutil.copyfile(source / 'backend/site_config.py', root / 'backend/site_config.py')
        return root

    def run_init(self, root, name):
        return subprocess.run([sys.executable, str(root / 'scripts/init_site.py'),
            '--public-origin', 'https://' + name + '.example.test',
            '--main-origin', 'https://main-' + name + '.example.test',
            '--gateway-url', 'https://gateway-' + name + '.example.test', '--name', name,
            '--project', name], capture_output=True, text=True)

    def test_new_sites_get_distinct_keys_without_printing_them_and_never_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            a = self.prepare(Path(folder), 'site-a')
            b = self.prepare(Path(folder), 'site-b')
            first = self.run_init(a, 'site-a')
            second = self.run_init(b, 'site-b')
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            a_key = json.loads((a / 'state/config.json').read_text())['auth-key']
            b_key = json.loads((b / 'state/config.json').read_text())['auth-key']
            self.assertNotEqual(a_key, b_key)
            self.assertGreaterEqual(len(a_key), 48)
            self.assertNotIn(a_key, first.stdout + first.stderr + (a / '.env').read_text())
            self.assertNotIn(b_key, second.stdout + second.stderr)
            retry = self.run_init(a, 'different-site')
            self.assertNotEqual(retry.returncode, 0)
            self.assertEqual(json.loads((a / 'state/config.json').read_text())['auth-key'], a_key)


if __name__ == '__main__': unittest.main(verbosity=2)
