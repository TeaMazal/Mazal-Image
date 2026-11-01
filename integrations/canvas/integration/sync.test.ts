import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjects, recoverNodeJobs, snapshot } from '../web/src/services/souhub-sync-state.ts';
import type { CanvasProject } from '../web/src/stores/canvas/use-canvas-store.ts';
import type { CanvasNodeData } from '../web/src/types/canvas.ts';
import type { CloudJob } from '../web/src/services/api/souhub.ts';
const project = (title = '原稿') => ({ id:'p', title, nodes:[], connections:[], updatedAt:'now' } as unknown as CanvasProject);
test('离线修改在云端版本未变时保留，刷新不丢失', () => {
 const original=project(), local=project('离线改稿');
 const result=mergeProjects([local],[],[{project:original,revision:2,deleted:null}],{p:{revision:2,snapshot:snapshot(original)}},()=> 'copy');
 assert.equal(result.projects[0].title,'离线改稿'); assert.equal(result.copies.length,0); assert.equal(result.bases.p.snapshot,snapshot(original));
});
test('双设备冲突保存两份内容，删除也不吞掉离线修改', () => {
 const original=project(), local=project('本机改稿'), remote=project('另一设备');
 const base={p:{revision:2,snapshot:snapshot(original)}};
 for (const deleted of [null,123]) {
  const result=mergeProjects([local],[],[{project:remote,revision:3,deleted}],base,()=> 'copy');
  assert.equal(result.projects.find(p=>p.id==='copy')?.title,'本机改稿 · 冲突副本');
  assert.equal(result.projects.some(p=>p.id==='p'),deleted===null);
 }
});
test('已同步项目再次聚焦不会触发编辑器重挂载', () => {
 const original=project();
 const result=mergeProjects([original],[],[{project:original,revision:2,deleted:null}],{p:{revision:2,snapshot:snapshot(original)}},()=> 'copy');
 assert.deepEqual(result.changedIds,[]);
});
test('未同步删除保持删除意图，远端修改时撤销旧版本删除', () => {
 const original=project(), base={p:{revision:2,snapshot:snapshot(original)}}, tombstone=[{id:'p',deletedAt:'now'}];
 assert.equal(mergeProjects([],tombstone,[{project:original,revision:2,deleted:null}],base,()=> 'copy').projects.length,0);
 const conflict=mergeProjects([],tombstone,[{project:original,revision:3,deleted:null}],base,()=> 'copy');
 assert.equal(conflict.projects.length,1);assert.equal(conflict.deleted.length,0);
});
const job=(id:string,image_id:string,status:string,created:number)=>({id,node_id:'n',image_id,status,created,asset_id:'asset',error:'失败'} as CloudJob);
const loaded={content:'blob:new',storageKey:'cloud:asset',naturalWidth:10,naturalHeight:20,bytes:10,mimeType:'image/png'};
test('批次部分失败按图片编号恢复，不串图、不覆盖手动改图',async()=>{
 const node={id:'n',metadata:{images:[{id:'a',canvasJobId:'j1',status:'loading'},{id:'b',canvasJobId:'j2',status:'loading'},{id:'c',canvasJobId:'old',status:'success',storageKey:'image:manual'}]}} as CanvasNodeData;
 let downloads=0;
 const result=await recoverNodeJobs(node,[job('j1','a','success',2),job('j2','b','error',3),job('old','c','success',1)],async()=>{downloads++;return loaded;});
 assert.equal(result.metadata?.images?.[0].status,'success');assert.equal(result.metadata?.images?.[1].status,'error');assert.equal(result.metadata?.images?.[2].storageKey,'image:manual');assert.equal(downloads,1);
});
test('重试任务尚在运行时不能恢复上轮结果',async()=>{
 const node={id:'n',metadata:{status:'loading',canvasJobId:'new'}} as CanvasNodeData;
 const result=await recoverNodeJobs(node,[job('old','unassigned','success',1),job('new','unassigned','running',2)],async()=>{throw Error('不应下载旧图');});
 assert.equal(result,node);
});
