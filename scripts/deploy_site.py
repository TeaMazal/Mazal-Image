"""在目标服务器校验、发布或回退统一发布包。默认仅检查，加 --apply 才上线。"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_live_frontend(source, root):
    live = root / 'frontend/src'
    candidate = source / 'frontend/src'
    if not live.is_dir():
        return
    missing = sorted(str(path.relative_to(live)) for path in live.rglob('*')
                     if path.is_file() and path.suffix in ('.ts', '.tsx', '.css')
                     and not (candidate / path.relative_to(live)).is_file())
    assert not missing, '发布包缺少服务器已有前端源码，先合并最新功能：' + ', '.join(missing)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]


def verify(folder):
    manifest = json.loads((folder / 'release.json').read_text())
    actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()} - {'release.json'}
    assert actual == set(manifest['files']), '发布包文件列表不符'
    for name, value in manifest['files'].items():
        path = folder / name
        assert path.resolve().is_relative_to(folder.resolve()) and not path.is_symlink(), '非法发布路径'
        assert sha(path) == value, '发布包文件哈希不符：' + name
    return manifest


def compose(container, service):
    labels = container['Config']['Labels']
    cmd = ['docker', 'compose']
    for name in labels['com.docker.compose.project.config_files'].split(','):
        cmd += ['-f', name]
    subprocess.run(cmd + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service], cwd=labels['com.docker.compose.project.working_dir'], check=True, stdout=subprocess.DEVNULL)


def healthy(name, expected):
    for _ in range(90):
        try:
            data = inspect(name)
            if data['Image'] == expected and data['State'].get('Health', {}).get('Status') == 'healthy':return
        except (subprocess.CalledProcessError, IndexError):pass
        time.sleep(1)
    raise RuntimeError('服务健康检查超时：' + name)


def install_web(source, target):
    # 保留旧的哈希资源，已打开的浏览器仍可完成加载。
    for p in source.rglob('*'):
        if not p.is_file() or p == source / 'index.html':continue
        dest = target / p.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        shutil.copyfile(p, dest)
        os.chmod(dest, 0o644)
    temp = target / 'index.html.next'
    shutil.copyfile(source / 'index.html', temp)
    os.chmod(temp, 0o644)
    temp.replace(target / 'index.html')


def rollback(op):
    record = json.loads((op / 'before.json').read_text())
    profile = record['profile']
    if 'webArchive' in record:
        with tempfile.TemporaryDirectory() as tmp:
            with tarfile.open(op / record['webArchive']) as tf:tf.extractall(tmp, filter='data')
            install_web(Path(tmp), Path(profile['webRoot']))
    for name, image in record.get('images', {}).items():
        subprocess.run(['docker', 'tag', image['id'], image['tag']], check=True)
    if 'gateway' in record:
        shutil.copyfile(op / 'gateway-before.py', Path(profile['root']) / 'gateway_integration.py')
        with tarfile.open(op / 'admin-before.tar.gz') as tf:tf.extractall(Path(profile['root']) / 'web-ui', filter='data')
    for name, image in record.get('images', {}).items():
        if profile['layout'] == 'static' and name == profile['backendContainer']:
            subprocess.run(['systemctl', 'restart', 'chatgpt2api.service'], check=True)
        else:compose(image['inspect'], image['service'])
        healthy(name, image['id'])
    active = Path(profile['root']) / 'operations/shared-release-current.json'
    if (op / 'active-before.json').exists():shutil.copyfile(op / 'active-before.json', active)
    elif active.exists():active.unlink()
    (op / 'rolled-back.json').write_text(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}))


def build_image(op, dockerfile, tag, source):
    path = op / (tag.replace(':', '-') + '.Dockerfile')
    path.write_text(dockerfile)
    with (op / (path.stem + '.log')).open('w') as log:
        subprocess.run(['docker', 'build', '-f', str(path), '-t', tag, str(source)], check=True, stdout=log, stderr=subprocess.STDOUT)
    return subprocess.check_output(['docker', 'image', 'inspect', '-f', '{{.Id}}', tag], text=True).strip()


def merge_web_routes(config):
    # 保留线上代理配置，仅补齐共享功能所需的路由。
    config = config.replace('(?:classic|image|workbench)', '(?:classic|workbench)')
    pattern = r'(location ~ \^/\(\?:)([^)]+)(\)\(\?:/\|\$\) \{)'
    def add_routes(match):
        routes = match[2].split('|')
        if not {'api', 'v1', 'accounts', '_next'}.issubset(routes):
            return match[0]
        return match[1] + '|'.join(dict.fromkeys(routes + ['v1beta', 'image', 'templates'])) + match[3]
    config = re.sub(pattern, add_routes, config)
    assert 'templates' in config and 'v1beta' in config, '未知 API 代理配置，停止覆盖'
    if 'location ^~ /template-media/' not in config:
        anchor = 'location ^~ /assets/'
        assert anchor in config, '未知静态资源配置，停止覆盖'
        config = config.replace(anchor, 'location ^~ /template-media/ { proxy_buffering on; proxy_pass http://backend:8080; }\n    ' + anchor, 1)
    return config


def deploy(args):
    archive = args.archive.resolve()
    assert re.fullmatch('[a-f0-9]{64}', args.sha256) and sha(archive) == args.sha256, '发布包 SHA256 不符'
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        with tarfile.open(archive) as tf:
            assert all(m.isfile() or m.isdir() for m in tf.getmembers()), '发布包不允许链接'
            tf.extractall(folder, filter='data')
        manifest = verify(folder)
        profile = json.loads((folder / 'source/sites' / (args.site + '.json')).read_text(encoding='utf-8'))
        root = Path(profile['root'])
        assert root.is_dir(), '服务器与站点配置不符'
        container = inspect(profile['backendContainer'])
        assert container['Config']['Labels']['com.docker.compose.project.working_dir'] == str(root), '部署目录不符'
        verify_live_frontend(folder / 'source', root)
        web_image = inspect(profile['webContainer'])['Image'] if profile['layout'] != 'static' else None
        if args.apply and web_image:
            assert args.expected_web_image == web_image, '前端镜像与预期不符；核对线上最新功能后提供 --expected-web-image'
        if args.backend:
            baseline = root / ('current-source' if profile['layout'] == 'static' else '.')
            for name in ['pyproject.toml', 'uv.lock']:
                assert sha(baseline / 'backend/engine' / name) == sha(folder / 'source/backend/engine' / name), '后端依赖变化需要单独迁移：' + name
        if not args.apply:
            print(json.dumps({'checked': True, 'site': args.site, 'release': manifest['release'], 'backend': args.backend}))
            return
        assert os.geteuid() == 0, '上线需要 sudo'
        import fcntl
        operations = root / 'operations'
        operations.mkdir(exist_ok=True)
        with (operations / 'shared-release.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if web_image:
                assert inspect(profile['webContainer'])['Image'] == web_image, '检查后前端已变化，停止发布'
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            op = operations / ('shared-' + manifest['release'] + '-' + stamp)
            shutil.copytree(folder, op / 'release')
            os.chmod(op, 0o700)
            source = op / 'release/source'
            web = op / 'release/web' / args.site
            before = {'profile': profile, 'images': {}}
            active = operations / 'shared-release-current.json'
            if active.exists():shutil.copyfile(active, op / 'active-before.json')
            builds = {}
            if profile['layout'] == 'static':
                with tarfile.open(op / 'web-before.tar.gz', 'w:gz') as tf:
                    for p in Path(profile['webRoot']).iterdir():tf.add(p, arcname=p.name)
                before['webArchive'] = 'web-before.tar.gz'
            else:
                old = inspect(profile['webContainer'])
                tag = 'mazal-shared-web:' + manifest['release']
                template = op / 'release/web-template.conf'
                subprocess.run(['docker', 'cp', profile['webContainer'] + ':/etc/nginx/templates/default.conf.template', str(template)], check=True, stdout=subprocess.DEVNULL)
                config = template.read_text()
                original = 'location = /site-config.js { proxy_pass http://backend:8080; }'
                replacement = 'location = /site-config.js { add_header Cache-Control no-store; include /etc/nginx/snippets/security-headers.conf; try_files $uri =404; }'
                assert original in config or replacement in config, '未知前端配置，停止覆盖'
                template.write_text(merge_web_routes(config.replace(original, replacement)) if args.backend else config.replace(original, replacement))
                image = build_image(op, 'FROM ' + old['Image'] + '\nCOPY web/' + args.site + '/ /usr/share/nginx/html/\nCOPY web-template.conf /etc/nginx/templates/default.conf.template\n', tag, op / 'release')
                before['images'][profile['webContainer']] = {'id': old['Image'], 'tag': old['Config']['Image'], 'inspect': old, 'service': 'web'}
                builds[profile['webContainer']] = image
            if args.backend:
                old = container
                tag = 'mazal-shared-backend:' + manifest['release']
                dockerfile = '''FROM node:22-alpine AS admin
WORKDIR /src
COPY backend/engine/VERSION backend/engine/CHANGELOG.md ./
COPY backend/engine/web/ ./web/
WORKDIR /src/web
RUN npm ci --no-audit --no-fund && npm run build
FROM BASE
COPY backend/engine/api /app/api
COPY backend/engine/services /app/services
COPY backend/engine/utils /app/utils
COPY backend/gateway_integration.py backend/site_config.py backend/maintenance.py backend/image_protocols.py backend/prompt_library.py /app/
COPY backend/template_data /app/template_data
COPY --from=admin /src/web/out /app/web_dist
ENV MI_LOCAL_ENGINE_IMAGE_ONLY=POLICY
'''.replace('BASE', old['Image']).replace('POLICY', '1' if profile['localEngineImageOnly'] else '0')
                builds[profile['backendContainer']] = build_image(op, dockerfile, tag, source)
                before['images'][profile['backendContainer']] = {'id': old['Image'], 'tag': old['Config']['Image'], 'inspect': old, 'service': profile['backendService']}
                if profile['layout'] == 'static':
                    shutil.copyfile(root / 'gateway_integration.py', op / 'gateway-before.py')
                    before['gateway'] = True
                    with tarfile.open(op / 'admin-before.tar.gz', 'w:gz') as tf:
                        for p in (root / 'web-ui').iterdir():tf.add(p, arcname=p.name)
            (op / 'before.json').write_text(json.dumps(before))
            try:
                for name, image in builds.items():
                    subprocess.run(['docker', 'tag', image, before['images'][name]['tag']], check=True)
                if args.backend and profile['layout'] == 'static':
                    shutil.copyfile(source / 'backend/gateway_integration.py', root / 'gateway_integration.py')
                    cid = subprocess.check_output(['docker', 'create', builds[profile['backendContainer']]], text=True).strip()
                    try:subprocess.run(['docker', 'cp', cid + ':/app/web_dist/.', str(root / 'web-ui')], check=True, stdout=subprocess.DEVNULL)
                    finally:subprocess.run(['docker', 'rm', cid], check=True, stdout=subprocess.DEVNULL)
                for name, image in builds.items():
                    if profile['layout'] == 'static' and name == profile['backendContainer']:
                        subprocess.run(['systemctl', 'restart', 'chatgpt2api.service'], check=True)
                    else:compose(before['images'][name]['inspect'], before['images'][name]['service'])
                    healthy(name, image)
                if profile['layout'] == 'static':install_web(web, Path(profile['webRoot']))
                with urllib.request.urlopen(urllib.request.Request(profile['publicOrigin'] + '/', headers={'User-Agent': 'Mazal-Image-Gateway/1.0', 'Cache-Control': 'no-cache'}), timeout=30) as response:
                    assert '<title>' + profile['name'] + '</title>' in response.read().decode(), '公开页面验证失败'
                state = {'site': args.site, 'release': manifest['release'], 'operation': str(op), 'source': str(source), 'backend_updated': args.backend, 'archive_sha256': args.sha256}
                active.write_text(json.dumps(state, indent=2))
                (op / 'activated.json').write_text(json.dumps(state, indent=2))
                print(json.dumps(state))
            except Exception:
                rollback(op)
                raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', choices=['mazal', 'souhub'])
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-web-image', help='Compose 站点上线前核对的完整镜像 ID，防止覆盖并行更新')
    parser.add_argument('--backend', action='store_true', help='同时构建、更新后端；先确认线上没有生成中的任务')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    if args.rollback:rollback(args.rollback.resolve())
    else:
        assert args.site and args.archive and args.sha256, '需要 --site --archive --sha256'
        deploy(args)
