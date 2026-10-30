import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

backend = str(Path(__file__).resolve().parents[1] / 'backend')


class SiteConfigTests(unittest.TestCase):
    def load(self, **changes):
        env = {**os.environ, 'MI_MAIN_ORIGIN': 'https://main.example.test',
               'MI_PUBLIC_ORIGIN': 'https://images.example.test', 'MI_GATEWAY_URL': 'http://gateway:8080',
               'MI_SITE_NAME': 'Site A', 'PYTHONPATH': backend, **changes}
        return subprocess.run([sys.executable, '-c', 'import json,site_config as c; print(json.dumps([c.SITE_NAME,c.MAIN_ORIGIN,c.IMAGE_ORIGIN,c.GATEWAY]))'],
                              env=env, capture_output=True, text=True)

    def test_sites_have_independent_brands_origins_and_gateways(self):
        a = self.load()
        b = self.load(MI_SITE_NAME='Site B', MI_MAIN_ORIGIN='https://other.example.test',
                      MI_PUBLIC_ORIGIN='https://other-image.example.test', MI_GATEWAY_URL='https://other-api.example.test')
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(b.returncode, 0, b.stderr)
        self.assertNotEqual(json.loads(a.stdout), json.loads(b.stdout))

    def test_invalid_or_missing_origins_fail_closed(self):
        for value in ('', '*', 'https://user:secret@example.test', 'https://example.test/path',
                      'javascript:alert(1)', 'https://example.test?key=secret', 'https://example.test/#fragment', 'https://example.test\n'):
            with self.subTest(value=value):
                self.assertNotEqual(self.load(MI_MAIN_ORIGIN=value).returncode, 0)

    def test_gateway_can_use_a_server_side_prefix_but_no_credentials(self):
        self.assertEqual(self.load(MI_GATEWAY_URL='https://api.example.test/prefix/').returncode, 0)
        self.assertNotEqual(self.load(MI_GATEWAY_URL='https://user:secret@api.example.test').returncode, 0)


if __name__ == '__main__': unittest.main(verbosity=2)
