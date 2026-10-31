"""从同一份前端产物和源码生成两站发布包；不收集运行配置或账号数据。"""
import argparse
import hashlib
import html
import json
import re
import shutil
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_web(source, target, profile, release):
    shutil.copytree(source, target)
    config = {key: profile[key] for key in ['name', 'mainOrigin', 'downloadPrefix', 'guideStorageKey']}
    (target / 'site-config.js').write_text('window.__MAZAL_IMAGE_CONFIG__=' + json.dumps(config, ensure_ascii=True) + ';\n')
    page = (target / 'index.html').read_text(encoding='utf-8')
    page = re.sub(r'<title>[^<]*</title>', '<title>' + html.escape(profile['name']) + '</title>', page)
    page = re.sub(r'(<meta name="apple-mobile-web-app-title" content=")[^"]*', lambda match: match[1] + html.escape(profile['name'], quote=True), page)
    (target / 'index.html').write_text(page, encoding='utf-8')
    manifest = json.loads((target / 'manifest.webmanifest').read_text(encoding='utf-8'))
    manifest.update(name=profile['name'], short_name=profile['name'], description=profile['name'] + ' 图片创作工作台')
    (target / 'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    for name in ['pwa-icon.svg', 'pwa-maskable-icon.svg']:
        icon = (target / name).read_text(encoding='utf-8')
        icon = re.sub(r'(<text\b[^>]*>)[^<]*(</text>)', lambda match: match[1] + html.escape(profile['icon']) + match[2], icon)
        (target / name).write_text(icon, encoding='utf-8')
    worker = (target / 'sw.js').read_text(encoding='utf-8')
    worker = re.sub(r"const CACHE_NAME = '[^']+'", "const CACHE_NAME = 'image-" + profile['id'] + '-' + release + "'", worker)
    (target / 'sw.js').write_text(worker, encoding='utf-8')
    # 内嵌入口不依赖解析阶段的同步脚本请求，避免空白文档阻塞登录交接。
    embed = page.replace('<script src="./site-config.js"></script>', '<script>' + (target / 'site-config.js').read_text() + '</script>')
    embed = embed.replace('<script src="/site-config.js"></script>', '<script>' + (target / 'site-config.js').read_text() + '</script>')
    embed = embed.replace('<script src="./color-mode.js"></script>', '<script>' + (target / 'color-mode.js').read_text(encoding='utf-8') + '</script>')
    embed = embed.replace('<div id="root"></div>', '<div id="root"><p role="status" style="padding:24px;color:#6b7280">正在加载创作空间…</p></div>')
    (target / 'embed.html').write_text(embed, encoding='utf-8')


def package(release, output, dist):
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,63}', release):
        raise ValueError('版本名只允许小写字母、数字、点和连字符')
    assert (dist / 'index.html').is_file(), '先构建 frontend/dist'
    assert not output.exists(), '发布目录已存在，使用新版本名'
    output.mkdir(parents=True)
    source = output / 'source'
    source.mkdir()
    for name in ['frontend', 'backend', 'deploy', 'docs', 'scripts', 'tests', 'sites', 'integrations', 'licenses']:
        if (ROOT / name).is_dir():
            shutil.copytree(ROOT / name, source / name, ignore=shutil.ignore_patterns('node_modules', 'dist', 'out', '.next', '.git', '__pycache__', '.env', 'state', 'backups', '*.log', '*.tsbuildinfo'))
    for name in ['AGENTS.md', 'README.md', 'LICENSE', 'NOTICE.md', 'VERSION', 'compose.yml', '.dockerignore', '.env.example']:
        if (ROOT / name).is_file(): shutil.copy2(ROOT / name, source / name)
    for name in ['mazal', 'souhub']:
        profile = json.loads((ROOT / 'sites' / (name + '.json')).read_text(encoding='utf-8'))
        render_web(dist, output / 'web' / name, profile, release)
    hashes = {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file()}
    manifest = {'release': release, 'files': hashes}
    (output / 'release.json').write_text(json.dumps(manifest, indent=2))
    archive = Path(str(output) + '.tar.gz')
    with tarfile.open(archive, 'w:gz') as tf:
        for p in output.iterdir():tf.add(p, arcname=p.name)
    (archive.parent / (archive.name + '.sha256')).write_text(digest(archive) + '  ' + archive.name + '\n')
    print(json.dumps({'release': release, 'archive': str(archive), 'sha256': digest(archive)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dist', type=Path, default=ROOT / 'frontend/dist')
    args = parser.parse_args()
    package(args.release, args.output.resolve(), args.dist.resolve())
