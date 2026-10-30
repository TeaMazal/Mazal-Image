"""为一个新站点生成独立配置和随机管理员密钥，不覆盖现有站点。"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--public-origin', required=True)
parser.add_argument('--main-origin', required=True)
parser.add_argument('--gateway-url', required=True)
parser.add_argument('--name', default='Mazal Image')
parser.add_argument('--project', default='mazal-image')
parser.add_argument('--port', type=int, default=8310)
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', args.project) or not 1 <= args.port <= 65535:
    parser.error('Invalid Compose project name or port')
if any('\n' in value or '\r' in value for value in (args.name, args.public_origin, args.main_origin, args.gateway_url)):
    parser.error('Configuration values cannot contain newlines')
os.environ.update(MI_SITE_NAME=args.name, MI_MAIN_ORIGIN=args.main_origin,
                  MI_PUBLIC_ORIGIN=args.public_origin, MI_GATEWAY_URL=args.gateway_url)
sys.path.insert(0, str(root / 'backend'))
from site_config import MAIN_ORIGIN, IMAGE_ORIGIN, GATEWAY, SITE_NAME

state = root / 'state'
backups = root / 'backups'
if (root / '.env').exists() or state.exists() or backups.exists():
    raise SystemExit('Existing site files found. Initialization will not overwrite them.')
os.umask(0o077)
for path in (state, state / 'data', backups):
    path.mkdir(mode=0o700)
config = {'auth-key': secrets.token_urlsafe(48), 'refresh_account_interval_minute': 5,
          'image_retention_days': 3, 'image_min_free_mb': 512,
          'proxy_runtime': {'enabled': False, 'skip_ssl_verify': False},
          'backup': {'enabled': False}, 'log_levels': ['error', 'warning', 'info']}
config_path = state / 'config.json'
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
values = {'COMPOSE_PROJECT_NAME': args.project, 'MI_BIND_ADDRESS': '127.0.0.1', 'MI_PORT': str(args.port),
          'MI_SITE_NAME': SITE_NAME, 'MI_PUBLIC_ORIGIN': IMAGE_ORIGIN, 'MI_MAIN_ORIGIN': MAIN_ORIGIN,
          'MI_GATEWAY_URL': GATEWAY, 'MI_TRUSTED_PROXY_CIDR': '172.16.0.0/12',
          'MI_MEDIA_LIMIT_MB': '1024', 'MI_MEDIA_MAX_AGE_HOURS': '72', 'MI_MIN_FREE_MB': '512',
          'MI_BACKUP_KEEP': '3', 'MI_BACKUP_LIMIT_MB': '32'}
def dotenv(value):
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
(root / '.env').write_text(''.join(key + '=' + dotenv(value) + '\n' for key, value in values.items()), encoding='utf-8')
(root / '.env').chmod(0o644)  # 此文件仅含公开站点配置，内部密钥在受限的 state/ 中。
if os.name == 'posix' and os.geteuid() == 0:
    for path in (state, state / 'data', backups, config_path):
        os.chown(path, 10001, 10001)
elif os.name == 'posix' and os.geteuid() != 10001:
    print('Before Docker startup, run: sudo chown -R 10001:10001 state backups')
print('Site initialized. Administrator/engine key is in state/config.json; no key was printed.')
