"""Conservative deletion policy for media shared with workbench histories.

Existing and newly generated images are protected by default. Administrators may
release protection explicitly; surviving server task references still win.
Browser-only histories cannot be enumerated server-side, hence this default.
"""
import json
import os
import threading
from pathlib import Path
from urllib.parse import unquote, urlsplit

LOCK=threading.RLock()

def root_path():
    return Path(os.environ.get('MI_DATA_DIR',str(Path(__file__).resolve().parents[1]/'data')))

def enabled(root=None):
    root=Path(root) if root is not None else root_path()
    return os.environ.get('MI_MEDIA_PROTECTION')=='1' or (root/'drawing-media-protection.json').exists()

def safe_path(value):
    value=str(value).replace('\\','/')
    if not value or value.startswith('/') or any(x in ('','..','.') for x in value.split('/')) or ':' in value:
        raise ValueError('invalid image path')
    return value

def _references(value,result):
    if isinstance(value,dict):
        for item in value.values():_references(item,result)
    elif isinstance(value,list):
        for item in value:_references(item,result)
    elif isinstance(value,str) and len(value)<4096:
        path=unquote(urlsplit(value).path)
        if '/images/' in path:result.add(path.split('/images/',1)[1])
        elif path.lower().endswith(('.png','.jpg','.jpeg','.webp','.gif')):
            result.add(path.lstrip('/'))
            parts=path.strip('/').split('/')
            if len(parts)>1:result.add('/'.join(parts[-2:]))

def snapshot(root=None):
    root=Path(root) if root is not None else root_path()
    if not enabled(root):return {'enabled':False,'unprotected':set(),'references':set(),'error':False}
    try:
        marker=root/'drawing-media-protection.json'
        if not marker.exists():
            root.mkdir(parents=True,exist_ok=True)
            with LOCK:
                if not marker.exists():marker.write_text('{"unprotected":[]}',encoding='utf-8')
        value=json.loads(marker.read_text(encoding='utf-8'))
        unprotected=value['unprotected']
        if not isinstance(unprotected,list) or any(not isinstance(x,str) for x in unprotected):raise ValueError()
        refs=set()
        tasks=root/'image_tasks.json'
        if tasks.exists():_references(json.loads(tasks.read_text(encoding='utf-8')),refs)
        return {'enabled':True,'unprotected':set(unprotected),'references':refs,'error':False}
    except (OSError,ValueError,KeyError,TypeError):
        return {'enabled':True,'unprotected':set(),'references':set(),'error':True}

def status(relative,state=None):
    state=state or snapshot();relative=safe_path(relative)
    if not state['enabled']:return {'protected':False,'protection_reason':'disabled'}
    reason='unconfirmed' if state['error'] else 'task_reference' if relative in state['references'] else 'protected' if relative not in state['unprotected'] else 'released'
    return {'protected':reason!='released','protection_reason':reason}

def set_protected(relative,protected):
    relative=safe_path(relative)
    with LOCK:
        state=snapshot()
        if not state['enabled'] or state['error']:raise ValueError('图片保护状态不可读，未修改')
        values=state['unprotected']
        if protected:values.discard(relative)
        else:values.add(relative)
        target=root_path()/'drawing-media-protection.json';temp=target.with_suffix('.tmp')
        temp.write_text(json.dumps({'unprotected':sorted(values)},ensure_ascii=False),encoding='utf-8');os.replace(temp,target)
    return status(relative)
