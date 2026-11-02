import base64,contextlib,importlib.util,io,json,os,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from PIL import Image

state=tempfile.TemporaryDirectory()
os.environ['CANVAS_DATA']=state.name
spec=importlib.util.spec_from_file_location('canvas_app',Path(__file__).with_name('app.py'))
service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)

def identity(request):
    owner=request.headers.get('authorization','Bearer alice').split()[-1]
    return {'owner':owner,'key_id':1,'role':'admin' if owner=='admin' else 'user','token':'test-only','ip':'127.0.0.1','balance':{},'engine_owner':'engine-'+owner}

class CanvasTests(unittest.TestCase):
    def setUp(self):
        self.auth=patch.object(service,'authenticate',identity);self.auth.start()
        self.client=TestClient(service.app)
        with contextlib.closing(service.db()) as c,c:
            for table in ('projects','assets','jobs'):c.execute('DELETE FROM '+table)
    def tearDown(self):self.client.close();self.auth.stop()
    def request(self,method,url,owner='alice',**kwargs):return self.client.request(method,url,headers={'Authorization':'Bearer '+owner},**kwargs)
    def project(self,id='p'):
        return {'id':id,'title':'测试','nodes':[],'connections':[]}
    def upload(self,owner='alice'):
        stream=io.BytesIO();Image.new('RGB',(10,20),'red').save(stream,format='PNG')
        response=self.request('POST','/api/canvas/assets',owner,content=stream.getvalue());self.assertEqual(response.status_code,200)
        return response.json(),stream.getvalue()
    def test_user_isolation_and_revision_conflict(self):
        body={'project':self.project(),'revision':0}
        self.assertEqual(self.request('PUT','/api/canvas/projects/p',json=body).status_code,200)
        self.assertEqual(self.request('PUT','/api/canvas/projects/p',json=body).status_code,409)
        self.assertEqual(self.request('GET','/api/canvas/projects','bob').json()['items'],[])
        self.assertEqual(self.request('DELETE','/api/canvas/projects/p?revision=1','bob').status_code,404)
    def test_assets_private_and_credentials_rejected(self):
        asset,_=self.upload()
        self.assertEqual(self.request('GET','/api/canvas/assets/'+asset['id'],'bob').status_code,404)
        project=self.project();project['nodes']=[{'metadata':{'storageKey':'cloud:'+asset['id']}}]
        self.assertEqual(self.request('PUT','/api/canvas/projects/p','bob',json={'project':project,'revision':0}).status_code,400)
        project['nodes']=[{'apiKey':'must-not-be-saved'}]
        self.assertEqual(self.request('PUT','/api/canvas/projects/p',json={'project':project,'revision':0}).status_code,400)
    def test_trash_protects_images_restore_and_permanent_delete(self):
        asset,_=self.upload();project=self.project();project['nodes']=[{'metadata':{'storageKey':'cloud:'+asset['id']}}]
        self.request('PUT','/api/canvas/projects/p',json={'project':project,'revision':0})
        self.assertEqual(self.request('DELETE','/api/canvas/projects/p?revision=1').status_code,200)
        self.assertEqual(self.request('DELETE','/api/canvas/assets/'+asset['id']).status_code,409)
        self.assertEqual(self.request('PUT','/api/canvas/projects/p',json={'project':project,'revision':2}).status_code,200)
        self.assertIsNone(self.request('GET','/api/canvas/projects').json()['items'][0]['deleted'])
        self.assertEqual(self.request('DELETE','/api/canvas/projects/p?revision=3&permanent=true').status_code,200)
        self.assertEqual(self.request('DELETE','/api/canvas/assets/'+asset['id']).status_code,200)
    def test_job_idempotency_and_uncertain_no_resubmission(self):
        payload={'project_id':'p','node_id':'n','image_id':'i','prompt':'产品白底图'}
        with patch.object(service,'engine_request',return_value={'status':'queued'}) as engine:
            for _ in range(2):self.assertEqual(self.request('POST','/api/canvas/jobs/j1',json=payload).status_code,200)
            self.assertEqual(engine.call_count,1)
        with patch.object(service,'engine_request',side_effect=service.HTTPException(503,'网络中断')) as engine:
            self.assertEqual(self.request('POST','/api/canvas/jobs/j2',json=payload).json()['status'],'uncertain')
            self.request('POST','/api/canvas/jobs/j2',json=payload);self.assertEqual(engine.call_count,1)
    def test_engine_result_persisted_and_backup_restorable(self):
        asset,content=self.upload()
        with patch.object(service,'engine_request',return_value={'status':'queued'}):
            self.request('POST','/api/canvas/jobs/j1',json={'prompt':'测试','project_id':'p','node_id':'n'})
        taskfile=Path(state.name)/'engine-tasks.json'
        taskfile.write_text(json.dumps({'tasks':[{'id':'j1','owner_id':'engine-alice','status':'success','data':[{'b64_json':base64.b64encode(content).decode()}]}]}))
        with patch.object(service,'TASK_FILE',taskfile):service.monitor_once()
        result=self.request('GET','/api/canvas/jobs').json()['items'][0]
        self.assertEqual(result['status'],'success');self.assertEqual(result['asset_id'],asset['id'])
        service.maintenance_once()
        backup=next((Path(state.name)/'backups').glob('*/complete')).parent
        with sqlite3.connect(backup/'canvas.sqlite3') as c:self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual((backup/'assets'/'alice'/asset['id']).read_bytes(),content)
    def test_user_can_submit_more_than_two_active_jobs_without_repeating_existing_requests(self):
        payload={'project_id':'p','node_id':'n','prompt':'产品白底图'}
        with patch.object(service,'engine_request',return_value={'status':'queued'}) as engine:
            for i in range(6):
                self.assertEqual(self.request('POST','/api/canvas/jobs/j'+str(i),json=payload).status_code,200)
            self.assertEqual(engine.call_count,6)
            self.assertEqual(self.request('POST','/api/canvas/jobs/j0',json=payload).status_code,200)
            self.assertEqual(engine.call_count,6)
        self.assertEqual(len(self.request('GET','/api/canvas/jobs').json()['items']),6)
    def test_admin_and_quota_enforced(self):
        self.assertEqual(self.request('GET','/api/canvas/admin','bob').status_code,403)
        limits=service.settings();limits['quota_bytes']=1
        with patch.object(service,'settings',return_value=limits):
            stream=io.BytesIO();Image.new('RGB',(10,20)).save(stream,format='PNG')
            self.assertEqual(self.request('POST','/api/canvas/assets',content=stream.getvalue()).status_code,413)

    def test_reference_limit_checked_before_reading_overflow(self):
        asset,_=self.upload()
        with contextlib.closing(service.db()) as c,c:
            c.execute('UPDATE assets SET bytes=? WHERE owner=? AND id=?',(service.MAX_UPLOAD+1,'alice',asset['id']))
        with patch.object(Path,'open',side_effect=AssertionError('oversized reference must not be read')),patch.object(service,'engine_request') as engine:
            response=self.request('POST','/api/canvas/jobs/oversized',json={'prompt':'test','assets':[asset['id']]})
        self.assertEqual(response.status_code,413);engine.assert_not_called()
        with contextlib.closing(service.db()) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)

    def test_repeated_references_enforce_aggregate_limit_before_allocation(self):
        asset,content=self.upload()
        with patch.object(service,'MAX_UPLOAD',len(content)),patch.object(service,'engine_request') as engine:
            response=self.request('POST','/api/canvas/jobs/repeated',json={'prompt':'test','assets':[asset['id'],asset['id']]})
        self.assertEqual(response.status_code,413);engine.assert_not_called()

    def test_malformed_task_and_admin_json_rejected(self):
        for payload in [b'{',b'null',b'[]']:
            self.assertEqual(self.request('POST','/api/canvas/jobs/invalid',content=payload).status_code,400)
            self.assertEqual(self.request('PUT','/api/canvas/admin','admin',content=payload).status_code,400)

    def test_idle_monitor_does_not_load_full_engine_history(self):
        with patch.object(Path,'read_text',side_effect=AssertionError('idle monitor should not read task history')):
            service.monitor_once()

if __name__=='__main__':
    unittest.main(verbosity=2)
