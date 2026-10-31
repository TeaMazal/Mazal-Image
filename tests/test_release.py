import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load('release')
deploy = load('deploy_site')


class ReleaseTests(unittest.TestCase):
    def test_release_cannot_omit_frontend_features_present_on_server(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            live = root / 'live/frontend/src/lib'
            candidate = root / 'release/frontend/src/lib'
            live.mkdir(parents=True)
            candidate.mkdir(parents=True)
            (live / 'studioRounds.ts').write_text('newer round behavior')
            with self.assertRaisesRegex(AssertionError, 'studioRounds.ts'):
                deploy.verify_live_frontend(root / 'release', root / 'live')
            (candidate / 'studioRounds.ts').write_text('merged round behavior')
            deploy.verify_live_frontend(root / 'release', root / 'live')

    def test_same_javascript_keeps_each_sites_brand_and_storage_preferences(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'dist'
            source.mkdir()
            for name in ['index.html', 'manifest.webmanifest', 'sw.js', 'pwa-icon.svg', 'pwa-maskable-icon.svg', 'color-mode.js']:
                (source / name).write_bytes((ROOT / 'frontend/public' / name).read_bytes() if name != 'index.html' else (ROOT / 'frontend/index.html').read_bytes())
            (source / 'app.js').write_text('same code')
            for site in ['mazal', 'souhub']:
                profile = json.loads((ROOT / 'sites' / (site + '.json')).read_text(encoding='utf-8'))
                target = root / site
                release.render_web(source, target, profile, 'test-1')
                self.assertEqual((target / 'app.js').read_bytes(), (source / 'app.js').read_bytes())
                self.assertIn(profile['name'], (target / 'index.html').read_text(encoding='utf-8'))
                self.assertIn(profile['guideStorageKey'], (target / 'site-config.js').read_text())
                self.assertIn(site + '-test-1', (target / 'sw.js').read_text(encoding='utf-8'))

    def test_modified_or_extra_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            data = folder / 'safe.txt'
            data.write_text('original')
            (folder / 'release.json').write_text(json.dumps({'release': 'test-1', 'files': {'safe.txt': deploy.sha(data)}}))
            deploy.verify(folder)
            data.write_text('changed')
            with self.assertRaises(AssertionError):deploy.verify(folder)
            data.write_text('original')
            (folder / '.env').write_text('must not enter releases')
            with self.assertRaises(AssertionError):deploy.verify(folder)

    def test_web_install_preserves_old_assets_and_replaces_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / 'live';new = root / 'release'
            old.mkdir();new.mkdir()
            (old / 'old.js').write_text('opened browser still needs this')
            (old / 'index.html').write_text('old')
            (new / 'new.js').write_text('new script')
            (new / 'index.html').write_text('new')
            deploy.install_web(new, old)
            self.assertTrue((old / 'old.js').exists())
            self.assertEqual((old / 'index.html').read_text(), 'new')


if __name__ == '__main__':unittest.main()
