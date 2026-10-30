"""Exercise installer failure boundaries using fake Git/Docker/curl, without installing services."""
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Linux root required; CI runs this with sudo')
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mazal-installer-check-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.log = self.base / 'commands.jsonl'
        fake = '''#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
command = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['MI_CHECK_LOG'], 'a') as log:
    log.write(json.dumps([command, *args]) + '\\n')
if command == 'git':
    if args[:1] == ['clone']:
        assert args[1:-1] == ['--depth', '1', '--branch', 'v0.1.1', '--', 'https://github.com/TeaMazal/Mazal-Image.git']
        dest = pathlib.Path(args[-1])
        (dest / 'scripts').mkdir(parents=True)
        (dest / 'backend').mkdir()
        for name in ('scripts/init_site.py', 'backend/site_config.py'):
            shutil.copyfile(pathlib.Path(os.environ['MI_CHECK_SOURCE']) / name, dest / name)
    elif len(args) == 4 and args[0] == '-C' and args[2:] == ['rev-parse', 'HEAD']:
        print(os.environ.get('MI_CHECK_COMMIT', 'db9efde7862d54152712c72806b2ea84e56e8e1a'))
    else:
        raise SystemExit('unexpected Git operation')
elif command == 'docker':
    assert not any(key.startswith('COMPOSE_') or (key.startswith('MI_') and not key.startswith('MI_CHECK_')) for key in os.environ), 'inherited site configuration'
    if args == ['compose', 'ls', '--all', '--format', 'json']:
        print(json.dumps([{'Name': os.environ['MI_CHECK_PROJECT']}] if os.environ.get('MI_CHECK_PROJECT') else []))
    elif args[:2] == ['compose', 'up']:
        assert args == ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '180']
        if os.environ.get('MI_CHECK_BUILD_FAIL'):
            raise SystemExit(42)
    elif args not in (['info'], ['compose', 'version'], ['compose', 'ps']):
        raise SystemExit('unexpected Docker operation')
elif command == 'curl':
    assert args[-1].startswith('http://127.0.0.1:') and args[-1].endswith('/healthz'), 'unexpected download'
else:
    raise SystemExit('unexpected command')
'''
        for command in ('git', 'docker', 'curl'):
            path = self.bin / command
            path.write_text(fake)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        MI_CHECK_SOURCE=str(SOURCE), MI_CHECK_LOG=str(self.log))
        # Never allow inherited Compose flags to affect even the mocked test.
        for name in list(self.env):
            if name.startswith('COMPOSE_'):
                del self.env[name]

    def run_installer(self, site='site-a', extra=(), changes=None, port=None):
        if port is None:
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
        env = dict(self.env)
        env.update(changes or {})
        return subprocess.run(['bash', str(SOURCE / 'scripts/install.sh'), '--yes',
            '--public-origin', 'https://image.example.test', '--main-origin', 'https://api.example.test',
            '--directory', str(self.base / site), '--project', site, '--port', str(port), *extra],
            env=env, capture_output=True, text=True, timeout=30)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_two_sites_get_independent_keys_and_secrets_are_not_printed(self):
        results = [self.run_installer(site) for site in ('site-a', 'site-b')]
        keys = []
        for site, result in zip(('site-a', 'site-b'), results):
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('安装和本机健康检查通过', result.stdout)
            key = json.loads((self.base / site / 'state/config.json').read_text())['auth-key']
            keys.append(key)
            self.assertNotIn(key, result.stdout + result.stderr + self.log.read_text())
            self.assertIn("COMPOSE_PROJECT_NAME='" + site + "'", (self.base / site / '.env').read_text())
        self.assertNotEqual(*keys)
        self.assertEqual(sum(c[:3] == ['docker', 'compose', 'up'] for c in self.commands()), 2)

    def test_existing_directory_is_unchanged_without_running_external_commands(self):
        site = self.base / 'site-a'
        site.mkdir()
        sentinel = site / 'existing-data'
        sentinel.write_text('keep')
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertEqual(self.commands(), [])

    def test_project_collision_stops_before_clone(self):
        result = self.run_installer(changes={'MI_CHECK_PROJECT': 'site-a'})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / 'site-a').exists())
        self.assertFalse(any(c[0] == 'git' for c in self.commands()))

    def test_occupied_port_stops_before_any_external_operations(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            result = self.run_installer(port=listener.getsockname()[1])
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / 'site-a').exists())
        self.assertEqual(self.commands(), [])

    def test_invalid_origin_and_v1_gateway_stop_before_clone(self):
        for extra in (('--public-origin', 'https://image.example.test/path'),
                      ('--gateway-url', 'https://api.example.test/v1'),
                      ('--port', '0'), ('--project', 'bad project')):
            with self.subTest(extra=extra):
                result = self.run_installer(extra=extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.base / 'site-a').exists())
                self.assertEqual(self.commands(), [])

    def test_source_commit_mismatch_stops_before_initialization(self):
        result = self.run_installer(changes={'MI_CHECK_COMMIT': '0' * 40})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / 'site-a/.env').exists())
        self.assertFalse(any(c[:3] == ['docker', 'compose', 'up'] for c in self.commands()))

    def test_failed_build_keeps_new_config_without_reporting_success(self):
        result = self.run_installer(changes={'MI_CHECK_BUILD_FAIL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.base / 'site-a/state/config.json').is_file())
        self.assertNotIn('安装和本机健康检查通过', result.stdout)
        self.assertFalse(any(c[0] == 'curl' for c in self.commands()))

    def test_shell_metacharacters_in_site_name_remain_literal(self):
        marker = self.base / 'must-not-exist'
        name = 'Image $(touch ' + str(marker) + ')'
        result = self.run_installer(extra=('--name', name))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(marker.exists())
        self.assertIn(name, (self.base / 'site-a/.env').read_text())

    def test_caller_compose_and_site_environment_cannot_redirect_install(self):
        result = self.run_installer(changes={'COMPOSE_FILE': '/some/other/site.yml',
            'COMPOSE_PROJECT_NAME': 'existing-site', 'MI_PORT': '1', 'MI_GATEWAY_URL': 'https://wrong.test'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which('script'), 'util-linux script needed for terminal test')
    def test_interactive_prompts_work_when_script_arrives_over_stdin(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        command = 'cat ' + shlex.quote(str(SOURCE / 'scripts/install.sh')) + ' | bash'
        answers = '\n'.join(['https://image.example.test', 'https://api.example.test', '', '',
                             'site-interactive', str(self.base / 'site-interactive'), str(port)]) + '\n'
        result = subprocess.run(['script', '-q', '-e', '-c', command, '/dev/null'], input=answers,
            env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('安装和本机健康检查通过', result.stdout)
        self.assertTrue((self.base / 'site-interactive/state/config.json').is_file())


if __name__ == '__main__':
    unittest.main(verbosity=2)
