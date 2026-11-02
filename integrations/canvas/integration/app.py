"""Souhub canvas projects and private assets; image billing remains in Sub2."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import io
import json
import logging
import os
import re
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg2
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, UnidentifiedImageError

ROOT = Path(os.environ.get('CANVAS_DATA', '/canvas-state'))
ROOT.mkdir(parents=True, exist_ok=True)
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
ENGINE = os.environ.get('CANVAS_ENGINE', 'http://backend:8080')
TASK_FILE = Path(os.environ.get('CANVAS_TASK_FILE', '/engine-state/image_tasks.json'))
PG_DSN = os.environ.get('CANVAS_PG_DSN', '')
MAX_UPLOAD = 24 * 1024 * 1024
LOCK = threading.RLock()
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def db():
    connection = sqlite3.connect(ROOT / 'canvas.sqlite3', timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    return connection


with contextlib.closing(db()) as c, c:
    c.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS projects(owner TEXT,id TEXT,revision INTEGER NOT NULL,data TEXT NOT NULL,deleted REAL,updated REAL,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS assets(owner TEXT,id TEXT,bytes INTEGER,mime TEXT,width INTEGER,height INTEGER,created REAL,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS jobs(owner TEXT,id TEXT,engine_owner TEXT,project_id TEXT,node_id TEXT,image_id TEXT,status TEXT,prompt TEXT,params TEXT,asset_id TEXT,error TEXT,created REAL,updated REAL,key_id INTEGER,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES(1,'{"enabled":true,"quota_bytes":1073741824,"trash_days":30,"reserve_bytes":5368709120}');
    ''')


def settings():
    with contextlib.closing(db()) as c:
        return json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])


def engine_request(path, token, ip, data=None, content_type='application/json', timeout=20):
    headers = {'Authorization': 'Bearer ' + token, 'X-Real-IP': ip, 'X-Forwarded-For': ip, 'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = content_type
    request = urllib.request.Request(ENGINE + path, headers=headers, data=data)
    try:
        with HTTP.open(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            result = json.loads(error.read(16384))
            detail = result.get('detail', result.get('error', {}))
            message = detail.get('error', detail.get('message', '请求失败')) if isinstance(detail, dict) else str(detail)
        except Exception:
            message = '绘图服务请求失败'
        raise HTTPException(error.code, str(message)[:400]) from None
    except (OSError, ValueError):
        raise HTTPException(503, '暂时无法连接绘图服务，请保留任务并稍后查询') from None


def authenticate(request):
    auth = request.headers.get('authorization', '')
    if not auth.startswith('Bearer ') or len(auth) > 4200:
        raise HTTPException(401, '请使用主站绘图密钥登录')
    token = auth[7:]
    if not token or any(ord(x) < 33 or ord(x) > 126 for x in token):
        raise HTTPException(401, '密钥格式无效')
    ip = request.client.host if request.client else ''
    balance = engine_request('/api/customer-balance', token, ip)
    try:
        with contextlib.closing(psycopg2.connect(PG_DSN, connect_timeout=5)) as pg:
            pg.set_session(readonly=True)
            with pg.cursor() as cur:
                cur.execute('SELECT k.user_id,k.id,u.role FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key=%s AND k.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status=%s', (token, 'active'))
                row = cur.fetchone()
    except psycopg2.Error:
        raise HTTPException(503, '用户身份服务暂时不可用') from None
    if not row:
        raise HTTPException(401, '无法确认密钥所属用户')
    owner = hashlib.sha256(('souhub-canvas:' + str(row[0])).encode()).hexdigest()[:32]
    return {'owner': owner, 'key_id': row[1], 'role': row[2], 'balance': balance, 'token': token, 'ip': ip,
            'engine_owner': 'sub2api-' + hashlib.sha256(token.encode()).hexdigest()[:32]}


@app.middleware('http')
async def headers(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def valid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,128}', value):
        raise HTTPException(400, '项目或任务编号无效')
    return value


def project_data(data):
    if not isinstance(data, dict) or not isinstance(data.get('nodes'), list) or not isinstance(data.get('connections'), list):
        raise HTTPException(400, '画布结构无效')
    allowed = {'id', 'title', 'createdAt', 'updatedAt', 'nodes', 'connections', 'chatSessions', 'activeChatId', 'backgroundMode', 'showImageInfo', 'viewport', 'archived'}
    data = {key: value for key, value in data.items() if key in allowed}
    def clean(value):
        if isinstance(value, dict):
            if any(key.lower().replace('_', '') in {'apikey','refreshtoken','accesstoken','idtoken','authorization','password'} for key in value):
                raise HTTPException(400, '项目文件不能包含登录凭据')
            return {key: clean(item) for key,item in value.items()}
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, str):
            if value.startswith('data:'):
                raise HTTPException(400, '请先保存素材，再同步项目')
            return '' if value.startswith('blob:') else value
        return value
    result = clean(data)
    try:
        json.dumps(result, allow_nan=False)
    except (ValueError, TypeError):
        raise HTTPException(400, '画布包含无效数值') from None
    return result


def usage(owner):
    with contextlib.closing(db()) as c:
        return c.execute('SELECT COALESCE(SUM(bytes),0) FROM assets WHERE owner=?',(owner,)).fetchone()[0]


def asset_path(owner, asset_id):
    return ASSETS / owner / valid_id(asset_id)


def put_asset(owner, content):
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, '单张素材不能超过 24 MB')
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
        with Image.open(io.BytesIO(content)) as image:
            width,height = image.size
            mime = Image.MIME.get(image.format, 'image/png')
            if image.format not in ('PNG','JPEG','WEBP','GIF'):
                raise ValueError()
    except (UnidentifiedImageError, ValueError, OSError, SyntaxError, Image.DecompressionBombError):
        raise HTTPException(400, '素材必须是有效的 PNG、JPEG、WebP 或 GIF 图片') from None
    asset_id = hashlib.sha256(content).hexdigest()
    with LOCK, contextlib.closing(db()) as c, c:
        row = c.execute('SELECT * FROM assets WHERE owner=? AND id=?',(owner,asset_id)).fetchone()
        if row:
            return dict(row)
        limits = settings()
        if usage(owner) + len(content) > limits['quota_bytes']:
            raise HTTPException(413, '云端素材空间已满，可删除素材或联系管理员调整额度；本地图片仍可下载')
        if shutil.disk_usage(ROOT).free - len(content) < limits['reserve_bytes']:
            raise HTTPException(507, '服务器存储空间不足，请先下载保存图片')
        path = asset_path(owner,asset_id)
        path.parent.mkdir(exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_bytes(content)
        tmp.replace(path)
        c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?)',(owner,asset_id,len(content),mime,width,height,time.time()))
        return {'id':asset_id,'bytes':len(content),'mime':mime,'width':width,'height':height}


def asset_public(row):
    return {key:row[key] for key in ('id','bytes','mime','width','height')}


@app.get('/healthz')
def health():
    return {'ok':True}


@app.get('/api/canvas/session')
def session(request:Request):
    identity=authenticate(request)
    return {'owner':identity['owner'],'key_id':identity['key_id'],'admin':identity['role']=='admin','balance':identity['balance'],
            'settings':settings(),'used_bytes':usage(identity['owner'])}


@app.get('/api/canvas/projects')
def projects(request:Request):
    owner=authenticate(request)['owner']
    with contextlib.closing(db()) as c:
        rows=c.execute('SELECT * FROM projects WHERE owner=? ORDER BY updated DESC',(owner,)).fetchall()
    return {'items':[{'project':json.loads(r['data']),'revision':r['revision'],'deleted':r['deleted']} for r in rows]}


@app.put('/api/canvas/projects/{project_id}')
async def save_project(project_id:str,request:Request):
    identity=await __import__('asyncio').to_thread(authenticate,request)
    raw=await request.body()
    if len(raw)>8*1024*1024:raise HTTPException(413,'项目结构超过 8 MB，请拆分画布')
    try:body=json.loads(raw)
    except ValueError:raise HTTPException(400,'项目内容无效') from None
    if not isinstance(body,dict):raise HTTPException(400,'项目内容无效')
    data=project_data(body.get('project'))
    if data.get('id')!=valid_id(project_id):raise HTTPException(400,'项目编号不一致')
    revision=body.get('revision')
    if type(revision) is not int or revision<0:raise HTTPException(400,'项目版本无效')
    owner=identity['owner']
    with LOCK,contextlib.closing(db()) as c,c:
        row=c.execute('SELECT * FROM projects WHERE owner=? AND id=?',(owner,project_id)).fetchone()
        if (row['revision'] if row else 0)!=revision:
            raise HTTPException(409,'另一设备已更新此画布，本次修改保留在本地，请另存副本')
        # Material references must belong to this user before a project is committed.
        for asset_id in set(re.findall(r'cloud:([a-f0-9]{64})',json.dumps(data))):
            if not c.execute('SELECT 1 FROM assets WHERE owner=? AND id=?',(owner,asset_id)).fetchone():
                raise HTTPException(400,'项目引用了不存在或无权访问的素材')
        c.execute('INSERT INTO projects VALUES(?,?,?,?,NULL,?) ON CONFLICT(owner,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,deleted=NULL,updated=excluded.updated',
                  (owner,project_id,revision+1,json.dumps(data,ensure_ascii=False),time.time()))
    return {'revision':revision+1}


@app.delete('/api/canvas/projects/{project_id}')
def trash_project(project_id:str,request:Request,revision:int,permanent:bool=False):
    owner=authenticate(request)['owner']
    with LOCK,contextlib.closing(db()) as c,c:
        row=c.execute('SELECT revision FROM projects WHERE owner=? AND id=?',(owner,valid_id(project_id))).fetchone()
        if not row:raise HTTPException(404,'项目不存在')
        if row[0]!=revision:raise HTTPException(409,'项目已被另一设备修改，请先同步再删除')
        if permanent:
            c.execute('DELETE FROM projects WHERE owner=? AND id=?',(owner,project_id))
        else:
            c.execute('UPDATE projects SET deleted=?,revision=revision+1,updated=? WHERE owner=? AND id=?',(time.time(),time.time(),owner,project_id))
    return {'revision':revision+1}


@app.post('/api/canvas/assets')
async def upload_asset(request:Request):
    identity=await __import__('asyncio').to_thread(authenticate,request)
    content=bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content)>MAX_UPLOAD:raise HTTPException(413,'单张素材不能超过 24 MB')
    return asset_public(await __import__('asyncio').to_thread(put_asset,identity['owner'],bytes(content)))


@app.get('/api/canvas/assets/{asset_id}')
def download_asset(asset_id:str,request:Request,thumbnail:bool=False):
    owner=authenticate(request)['owner']
    with contextlib.closing(db()) as c:
        row=c.execute('SELECT * FROM assets WHERE owner=? AND id=?',(owner,valid_id(asset_id))).fetchone()
    if not row:raise HTTPException(404,'素材不存在')
    path=asset_path(owner,asset_id)
    if thumbnail:
        preview=path.with_suffix('.webp')
        if not preview.exists():
            with LOCK,Image.open(path) as image:
                image.thumbnail((512,512))
                image.convert('RGB').save(preview,'WEBP',quality=80)
        return FileResponse(preview,media_type='image/webp')
    return FileResponse(path,media_type=row['mime'])


@app.get('/api/canvas/assets')
def list_assets(request:Request):
    owner=authenticate(request)['owner']
    with contextlib.closing(db()) as c:
        rows=c.execute('SELECT * FROM assets WHERE owner=? ORDER BY created DESC',(owner,)).fetchall()
    return {'items':[asset_public(r) for r in rows],'used_bytes':usage(owner)}


@app.delete('/api/canvas/assets/{asset_id}')
def delete_asset(asset_id:str,request:Request):
    owner=authenticate(request)['owner'];valid_id(asset_id)
    with LOCK,contextlib.closing(db()) as c,c:
        if c.execute('SELECT 1 FROM projects WHERE owner=? AND data LIKE ? LIMIT 1',(owner,'%cloud:'+asset_id+'%')).fetchone():
            raise HTTPException(409,'素材仍被画布或回收站引用，请先移除相关引用')
        c.execute("UPDATE jobs SET asset_id='',error='生成结果已由用户删除，账单保留' WHERE owner=? AND asset_id=? AND status='success'",(owner,asset_id))
        c.execute('DELETE FROM assets WHERE owner=? AND id=?',(owner,asset_id))
        asset_path(owner,asset_id).unlink(missing_ok=True)
        asset_path(owner,asset_id).with_suffix('.webp').unlink(missing_ok=True)
    return {'ok':True}


def jobs_public(row):
    result={key:row[key] for key in ('id','project_id','node_id','image_id','status','prompt','asset_id','error','created','key_id')}
    result['params']=json.loads(row['params'])
    result['billing']='以主站用量记录为准'
    return result


def reference_blobs(owner, references):
    blobs=[];total=0
    with LOCK,contextlib.closing(db()) as c:
        for asset_id in references:
            row=c.execute('SELECT mime,bytes FROM assets WHERE owner=? AND id=?',(owner,valid_id(asset_id))).fetchone()
            if not row:raise HTTPException(404,'参考图不存在')
            total+=row['bytes']
            if total>MAX_UPLOAD:raise HTTPException(413,'参考图合计不能超过 24 MB')
            with asset_path(owner,asset_id).open('rb') as source:content=source.read(row['bytes']+1)
            if len(content)!=row['bytes']:raise HTTPException(409,'参考图文件不完整，请重新上传')
            blobs.append((content,row['mime']))
    return blobs


@app.get('/api/canvas/jobs')
def jobs(request:Request):
    owner=authenticate(request)['owner']
    with contextlib.closing(db()) as c:
        rows=c.execute('SELECT * FROM jobs WHERE owner=? ORDER BY created DESC',(owner,)).fetchall()
    return {'items':[jobs_public(row) for row in rows]}


@app.post('/api/canvas/jobs/{job_id}')
async def create_job(job_id:str,request:Request):
    identity=await __import__('asyncio').to_thread(authenticate,request)
    if not settings()['enabled']:raise HTTPException(503,'画布生成暂未开放')
    valid_id(job_id)
    with contextlib.closing(db()) as c:
        old=c.execute('SELECT * FROM jobs WHERE owner=? AND id=?',(identity['owner'],job_id)).fetchone()
    if old:return jobs_public(old)
    if len(await request.body())>30*1024*1024:raise HTTPException(413,'参考图片过大')
    try:body=await request.json()
    except ValueError:raise HTTPException(400,'任务内容无效') from None
    if not isinstance(body,dict):raise HTTPException(400,'任务内容无效')
    prompt=body.get('prompt','')
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>16000:raise HTTPException(400,'提示词为空或超过 16000 字符')
    params={'model':'gpt-image-2','size':body.get('size') or '1024x1024','quality':body.get('quality') or 'auto'}
    if params['quality'] not in ('auto','low','medium','high'):raise HTTPException(400,'当前接口支持 auto、low、medium、high 质量')
    if not isinstance(params['size'],str) or not re.fullmatch(r'auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}',params['size']):raise HTTPException(400,'图片尺寸无效')
    references=body.get('assets',[])
    if not isinstance(references,list):raise HTTPException(400,'参考图格式无效')
    blobs=await asyncio.to_thread(reference_blobs,identity['owner'],references)
    with LOCK,contextlib.closing(db()) as c,c:
        if c.execute('SELECT 1 FROM jobs WHERE owner=? AND id=?',(identity['owner'],job_id)).fetchone():
            row=c.execute('SELECT * FROM jobs WHERE owner=? AND id=?',(identity['owner'],job_id)).fetchone();return jobs_public(row)
        c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(identity['owner'],job_id,identity['engine_owner'],valid_id(body.get('project_id','unassigned')),valid_id(body.get('node_id','unassigned')),valid_id(body.get('image_id','unassigned')),'submitting',prompt,json.dumps(params),'','',time.time(),time.time(),identity['key_id']))
    payload={'client_task_id':job_id,'prompt':prompt,**params}
    if blobs:
        boundary='canvas-'+os.urandom(12).hex();parts=[]
        for key,value in payload.items():parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
        for index,(content,mime) in enumerate(blobs):
            parts.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="ref-{index}.png"\r\nContent-Type: {mime}\r\n\r\n').encode(),content,b'\r\n'])
        parts.append(f'--{boundary}--\r\n'.encode());data=b''.join(parts)
        path='/api/image-tasks/edits';content_type='multipart/form-data; boundary='+boundary
    else:data=json.dumps(payload).encode();path='/api/image-tasks/generations';content_type='application/json'
    try:
        result=await __import__('asyncio').to_thread(engine_request,path,identity['token'],identity['ip'],data,content_type)
        status=result.get('status','queued');error=''
    except HTTPException as error_response:
        status='uncertain' if error_response.status_code>=500 or error_response.status_code==408 else 'error'
        error=str(error_response.detail)
    with LOCK,contextlib.closing(db()) as c,c:
        c.execute("UPDATE jobs SET status=?,error=?,updated=? WHERE owner=? AND id=? AND status='submitting'",(status,error,time.time(),identity['owner'],job_id))
        row=c.execute('SELECT * FROM jobs WHERE owner=? AND id=?',(identity['owner'],job_id)).fetchone()
    return jobs_public(row)


def monitor_once():
    with contextlib.closing(db()) as c:
        rows=c.execute("SELECT * FROM jobs WHERE status IN ('submitting','queued','running','uncertain','saving')").fetchall()
    if not rows:return
    if not TASK_FILE.exists():return
    try:tasks=json.loads(TASK_FILE.read_text()).get('tasks',[])
    except (OSError,ValueError):return
    indexed={(t.get('owner_id'),t.get('id')):t for t in tasks}
    for row in rows:
        task=indexed.get((row['engine_owner'],row['id']))
        if not task:
            if row['status'] in ('submitting','queued','running') and time.time()-row['created']>60:
                with LOCK,contextlib.closing(db()) as c,c:
                    c.execute("UPDATE jobs SET status='uncertain',error='提交结果待确认，请勿重复生成，联系管理员核查原任务',updated=? WHERE owner=? AND id=?",(time.time(),row['owner'],row['id']))
            continue
        status=task.get('status');error=task.get('error','');asset_id=''
        if status=='success':
            try:
                item=task['data'][0]
                if item.get('b64_json'):content=base64.b64decode(item['b64_json'],validate=True)
                else:
                    parsed=urllib.parse.urlparse(item.get('url',''))
                    if parsed.hostname not in ('img.souhub.top',None) or not parsed.path.startswith('/images/'):
                        raise ValueError('图片地址不属于本站图片存储')
                    with HTTP.open(ENGINE+parsed.path,timeout=30) as response:content=response.read(MAX_UPLOAD+1)
                asset_id=put_asset(row['owner'],content)['id']
            except Exception as failure:
                status='saving';error=str(failure.detail) if isinstance(failure,HTTPException) else '图片已生成，正在恢复持久保存；请勿重新提交'
        if status not in ('queued','running','success','error','saving'):continue
        with LOCK,contextlib.closing(db()) as c,c:
            c.execute('UPDATE jobs SET status=?,asset_id=?,error=?,updated=? WHERE owner=? AND id=?',(status,asset_id,error,time.time(),row['owner'],row['id']))


def maintenance_once():
    cutoff=time.time()-settings()['trash_days']*86400
    with LOCK,contextlib.closing(db()) as c,c:
        c.execute('DELETE FROM projects WHERE deleted IS NOT NULL AND deleted<?',(cutoff,))
    backup=ROOT/'backups';backup.mkdir(exist_ok=True)
    target=backup/time.strftime('%Y%m%d')
    if not (target/'complete').exists():
        with LOCK:
            target.mkdir(exist_ok=True)
            with contextlib.closing(db()) as source,contextlib.closing(sqlite3.connect(target/'canvas.sqlite3')) as dest:source.backup(dest)
            # 素材按内容寻址、写入后不可变，硬链接快照不会重复占用图片空间。
            for source in ASSETS.rglob('*'):
                if not source.is_file() or source.suffix:continue
                dest=target/'assets'/source.relative_to(ASSETS)
                dest.parent.mkdir(parents=True,exist_ok=True)
                if not dest.exists():os.link(source,dest)
            (target/'complete').touch()
    for old in backup.iterdir():
        if old.is_dir() and re.fullmatch(r'\d{8}',old.name) and old.stat().st_mtime<time.time()-7*86400:
            shutil.rmtree(old)


def monitor():
    while True:
        try:monitor_once();maintenance_once()
        except Exception as failure:logging.error('canvas maintenance failed: %s',type(failure).__name__)
        time.sleep(3)


@app.on_event('startup')
def startup():
    threading.Thread(target=monitor,name='canvas-results',daemon=True).start()


@app.get('/api/canvas/admin')
def admin_get(request:Request):
    if authenticate(request)['role']!='admin':raise HTTPException(403,'仅主站管理员可管理画布设置')
    with contextlib.closing(db()) as c:
        totals=c.execute('SELECT COUNT(DISTINCT owner),COUNT(*),COALESCE(SUM(bytes),0) FROM assets').fetchone()
        projects=c.execute('SELECT COUNT(*) FROM projects').fetchone()[0]
    return {'settings':settings(),'users':totals[0],'assets':totals[1],'bytes':totals[2],'projects':projects}


@app.put('/api/canvas/admin')
async def admin_save(request:Request):
    if (await __import__('asyncio').to_thread(authenticate,request))['role']!='admin':raise HTTPException(403,'仅主站管理员可管理画布设置')
    try:data=await request.json()
    except ValueError:raise HTTPException(400,'管理设置内容无效') from None
    if not isinstance(data,dict):raise HTTPException(400,'管理设置内容无效')
    current=settings()
    for key in ('quota_bytes','trash_days','reserve_bytes'):
        if key in data:
            if type(data[key]) is not int or data[key]<=0:raise HTTPException(400,'限额必须为正整数')
            current[key]=data[key]
    if 'enabled' in data:
        if type(data['enabled']) is not bool:raise HTTPException(400,'开关格式无效')
        current['enabled']=data['enabled']
    with LOCK,contextlib.closing(db()) as c,c:c.execute('UPDATE settings SET data=? WHERE id=1',(json.dumps(current),))
    return {'settings':current}
