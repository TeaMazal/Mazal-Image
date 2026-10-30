"""在构建得到的 Python 运行环境中收集依赖元数据和随包许可原文。"""
import importlib.metadata
import json
from pathlib import Path
import sys

destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
report = []
for dist in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata.get('Name', '').lower()):
    name = dist.metadata.get('Name', 'unknown')
    item = {'name': name, 'version': dist.version,
            'license': dist.metadata.get('License-Expression') or dist.metadata.get('License') or '', 'files': []}
    for file in dist.files or []:
        if file.name.lower().startswith(('license', 'licence', 'copying', 'notice')):
            path = Path(dist.locate_file(file))
            if path.is_file() and path.stat().st_size < 2 * 1024**2:
                relative = Path(name + '-' + dist.version) / str(file).replace('..', '_parent')
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(path.read_bytes())
                item['files'].append(relative.as_posix())
    report.append(item)
(destination / 'index.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Collected Python dependency license records:', len(report))
