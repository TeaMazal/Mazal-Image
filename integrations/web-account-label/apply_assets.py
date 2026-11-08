"""Reproduce r33 Web labels in a reviewed build; never deploy or touch account data."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

FILES = ['AccountsView-Dm_UELBN.js', 'proxyExpiry-Bd6wAaSM.js']


def transform(assets):
    files = FILES
    s=assets[files[0]].decode()
    helpers="\nfunction souhubIsWeb(row){return row?.platform==='openai'&&(row.credentials?.source_type==='web'||row.credentials?.client_id==='app_2SKx67EdpoN0G6j64rFvigXD')}\nfunction souhubAccountName(row,value){const name=String(value??'');return souhubIsWeb(row)?name.replace(/^\\[Web\\]\\s*/i,''):name}\n"
    assert 'souhubIsWeb' not in s
    s=helpers+s
    start=s.index('"cell-name":');end=s.index('"cell-notes":',start)
    section=s[start:end]
    assert section.count('t(ne)')==2 and section.count('String(ne||"").trim()')==1
    section=section.replace('t(ne)','t(souhubAccountName(j,ne))').replace('String(ne||"").trim()','souhubAccountName(j,ne).trim()')
    s=s[:start]+section+s[end:]
    old='z(iu,{platform:j.platform,type:j.type,"auth-mode":wr(j)'
    assert s.count(old)==1
    s=s.replace(old,'z(iu,{platform:j.platform,type:j.type,"source-label":souhubIsWeb(j)?"Web":void 0,"auth-mode":wr(j)')
    old='["platform","type","auth-mode","plan-type","privacy-mode","subscription-expires-at"]'
    assert s.count(old)==1
    s=s.replace(old,'["platform","type","source-label","auth-mode","plan-type","privacy-mode","subscription-expires-at"]')


    assets[files[0]]=s.encode()
    s=assets[files[1]].decode()
    old='__name:"PlatformTypeBadge",props:{platform:{},type:{},authMode:{}'
    assert s.count(old)==1
    s=s.replace(old,'__name:"PlatformTypeBadge",props:{platform:{},type:{},sourceLabel:{},authMode:{}')
    old='M("span",{class:Y(["inline-flex items-center gap-1 px-1.5 py-1",f.value])}'
    assert s.count(old)==1
    new='s.sourceLabel?M("span",{class:"inline-flex items-center px-2 py-1 font-semibold bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",title:s.sourceLabel+" 授权来源","data-account-source":s.sourceLabel},P(s.sourceLabel),9,["title","data-account-source"]):$("",!0),M("span",{class:Y(["inline-flex items-center gap-1 px-1.5 py-1",s.sourceLabel?"bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300":f.value])}'
    s=s.replace(old,new)


    assets[files[1]]=s.encode()
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--source-prefix', default='assets-souhub-drawing-r32')
    parser.add_argument('--target-prefix', default='assets-souhub-web-label-r33')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    for prefix in (args.source_prefix, args.target_prefix):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', prefix):
            parser.error('Asset prefix must be a single directory name')
    if args.source_prefix == args.target_prefix:
        parser.error('Use a new asset namespace to invalidate immutable caches')
    source = args.dist / args.source_prefix
    target = args.dist / args.target_prefix
    manifest = json.loads(Path(__file__).with_name('asset-manifest.json').read_text())
    assets = {name: (source / name).read_bytes() for name in FILES}
    if all(hashlib.sha256(data).hexdigest() == manifest[name]['before'] for name, data in assets.items()):
        assets = transform(assets)
    for name, data in assets.items():
        if hashlib.sha256(data).hexdigest() != manifest[name]['after']:
            raise SystemExit('Baseline differs; review source before applying: ' + name)
    if target.exists():
        raise SystemExit('Target namespace already exists; use a fresh build directory')
    index = args.dist / 'index.html'
    if args.source_prefix not in index.read_text(encoding='utf-8'):
        raise SystemExit('HTML does not reference the selected source namespace')
    if not args.apply:
        print('Baseline and transformations verified; use --apply in an isolated build directory.')
        return
    shutil.copytree(source, target)
    for name, data in assets.items():
        (target / name).write_bytes(data)
    for path in target.rglob('*'):
        if path.is_file() and path.suffix in ('.js', '.css', '.json'):
            data = path.read_bytes().replace(args.source_prefix.encode(), args.target_prefix.encode())
            path.write_bytes(data)
    for name in ('index.html', 'compat-index.html'):
        path = args.dist / name
        if path.exists():
            path.write_bytes(path.read_bytes().replace(args.source_prefix.encode(), args.target_prefix.encode()))
    print('Created new asset namespace. Rebuild and validate the main service before deployment.')


if __name__ == '__main__':
    main()
