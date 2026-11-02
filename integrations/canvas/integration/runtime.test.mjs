import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { build } = require('esbuild');
let instance = 0;

async function load(entry, fixture, mocks) {
    const id = ++instance;
    globalThis[`canvasTest${id}`] = fixture;
    const result = await build({
        entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
        bundle: true, write: false, format: 'esm', platform: 'node',
        plugins: [{ name: 'canvas-test-io', setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => args.path in mocks ? { path: args.path, namespace: 'test-io' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'test-io' }, (args) => ({ contents: `const f=globalThis.canvasTest${id};\n${mocks[args.path]}`, loader: 'js' }));
        } }],
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n// instance ${id}`).toString('base64')}`);
}

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const project = (title = '原稿', nodes = []) => ({ id: 'p', title, nodes, connections: [] });
class CloudError extends Error { constructor(message, status) { super(message); this.status = status; } }

test('画布同时提交所有图片，取消后的请求不提交，结果按原任务编号返回', async () => {
    const originals = Object.fromEntries(['window', 'sessionStorage', 'localStorage', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const gate = deferred();
    const jobs = [];
    globalThis.window = new EventTarget();
    globalThis.sessionStorage = globalThis.localStorage = { getItem: () => 'test-only' };
    globalThis.fetch = async (path, init = {}) => {
        if (path.startsWith('/api/canvas/jobs/') && init.method === 'POST') {
            const id = path.split('/').pop();
            jobs.push({ id, status: 'success', asset_id: id });
            await gate.promise;
            return Response.json({ id, status: 'queued' });
        }
        if (path === '/api/canvas/jobs') return Response.json({ items: jobs });
        if (path.startsWith('/api/canvas/assets/')) return new Response(new Blob(['image']));
        throw new Error('Unexpected fixture request');
    };
    try {
        const api = await load('../web/src/services/api/souhub.ts', {}, { '@/services/image-storage': 'export const setImageBlob=async(key)=>key;' });
        const cancelled = new AbortController();cancelled.abort();
        await assert.rejects(api.requestCanvasImage('取消', {}, [], undefined, cancelled.signal), { name: 'AbortError' });
        assert.equal(jobs.length, 0);
        const requests = Array.from({ length: 6 }, () => api.requestCanvasImage('并行生图', {}, []));
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(jobs.length, 6);
        gate.resolve();
        const results = await Promise.all(requests);
        assert.equal(new Set(results.map((item) => item[0].id)).size, 6);
        assert.deepEqual(results.map((item) => item[0].id), jobs.map((item) => item.id));
        assert.equal(jobs.length, 6);
    } finally {
        gate.resolve();
        for (const [name, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
});

async function syncFixture() {
    globalThis.window = Object.assign(new EventTarget(), { __SOUHUB_CANVAS__: { owner: 'test' } });
    let state = { projects: [], deletedProjects: [] };
    const f = {
        remote: { project: project(), revision: 1, deleted: null }, puts: [],
        state: () => state,
        edit(value) { state = { ...state, projects: [value] }; },
        store: {
            getState: () => ({ ...state, replaceProjects: (projects, deletedProjects) => { state = { projects, deletedProjects }; } }),
            setState: (update) => { state = { ...state, ...update(state) }; },
        },
        upload: async () => ({ id: 'asset' }),
        async request(path, init = {}) {
            if (path === '/projects') return structuredClone({ items: [f.remote] });
            if (init.method === 'PUT') {
                const body = JSON.parse(init.body); f.puts.push(body);
                if (body.revision !== f.remote.revision) throw new CloudError('conflict', 409);
                f.remote = { ...f.remote, project: body.project, revision: body.revision + 1 };
                return { revision: f.remote.revision };
            }
            throw Error('unexpected request: ' + path);
        }, CloudError,
    };
    const module = await load('../web/src/services/souhub-sync.ts', f, {
        'localforage': 'export default {setItem: async()=>{},getItem:async()=>null};',
        '@/stores/canvas/use-canvas-store': 'export const useCanvasStore=f.store;',
        '@/services/image-storage': 'export const getImageBlob=async()=>new Blob(["image"]); export const setImageBlob=async()=>"blob:result";',
        '@/services/api/souhub': 'export const canvasRequest=(...args)=>f.request(...args); export const uploadCloudBlob=(...args)=>f.upload(...args); export const cloudBlob=async()=>new Blob(); export const CloudError=f.CloudError;',
    });
    await module.pullCloud();
    return { f, module };
}

test('上传中拉取远端不会借用新版本覆盖另一设备内容', async () => {
    const { f, module } = await syncFixture();
    const uploading = deferred(), resume = deferred();
    f.upload = async () => { uploading.resolve(); await resume.promise; return { id: 'asset' }; };
    f.edit(project('本机修改', [{ metadata: { storageKey: 'image:local' } }]));
    const saving = module.flushCloud(); await uploading.promise;
    f.remote = { project: project('另一设备修改'), revision: 2, deleted: null };
    const pulling = module.pullCloud();
    await Promise.resolve(); resume.resolve();
    await Promise.all([saving, pulling]);
    assert.equal(f.puts[0].revision, 1);
    assert.equal(f.remote.project.title, '另一设备修改');
    assert(f.state().projects.some((item) => item.title === '本机修改 · 冲突副本'));
});

test('保存期间的后续修改仍会继续同步', async () => {
    const { f, module } = await syncFixture();
    const uploading = deferred(), resume = deferred();
    f.upload = async () => { uploading.resolve(); await resume.promise; return { id: 'asset' }; };
    f.edit(project('第一次修改', [{ metadata: { storageKey: 'image:local' } }]));
    const first = module.flushCloud(); await uploading.promise;
    f.edit(project('保存期间继续修改'));
    const second = module.flushCloud(); resume.resolve();
    await Promise.all([first, second]);
    assert.equal(f.remote.project.title, '保存期间继续修改');
    assert.deepEqual(f.puts.map((body) => body.revision), [1, 2]);
});

test('导出包含云端图片原文件，导入重建为当前用户的本地素材', async () => {
    const f = { blobs: new Map([['cloud:hash', new Blob(['original-image'], { type: 'image/png' })]]), entries: null, saved: null };
    const mocks = {
        'file-saver': 'export const saveAs=(blob)=>{f.saved=blob};',
        '@/i18n': 'export default {t:(key)=>key};',
        '@/lib/zip': 'export const createZip=async(entries)=>{f.entries=entries;return new Blob()};',
        '@/services/file-storage': 'export const getMediaBlob=async()=>undefined;',
        '@/services/image-storage': 'export const getImageBlob=async(key)=>f.blobs.get(key); export const setImageBlob=async(key,blob)=>{f.blobs.set(key,blob)};',
    };
    const exporter = await load('../web/src/lib/canvas/canvas-export.ts', f, mocks);
    const p = project('导出', [{ metadata: { storageKey: 'cloud:hash', content: 'blob:old' } }]);
    await exporter.exportCanvasProjects([p]);
    const manifest = JSON.parse(f.entries.find((entry) => entry.name === 'projects.json').data);
    const file = manifest.projects[0].files[0]; assert(file);
    const zip = new Map(f.entries.filter((entry) => entry.name !== 'projects.json').map((entry) => [entry.name, entry.data]));
    const importer = await load('../web/src/lib/canvas/canvas-import.ts', f, mocks);
    const imported = await importer.restoreProjectImages(manifest.projects[0], zip);
    const key = imported.nodes[0].metadata.storageKey;
    assert.match(key, /^image:/); assert.equal(imported.nodes[0].metadata.content, '');
    assert.equal(await f.blobs.get(key).text(), 'original-image');
    assert.equal(p.nodes[0].metadata.storageKey, 'cloud:hash');
});

test('素材缺失时导出应报错，不能生成缺图备份', async () => {
    const f = { saved: false };
    const exporter = await load('../web/src/lib/canvas/canvas-export.ts', f, {
        'file-saver': 'export const saveAs=()=>{f.saved=true};',
        '@/i18n': 'export default {t:(key)=>key};',
        '@/lib/zip': 'export const createZip=async()=>new Blob();',
        '@/services/file-storage': 'export const getMediaBlob=async()=>undefined;',
        '@/services/image-storage': 'export const getImageBlob=async()=>undefined;',
    });
    await assert.rejects(exporter.exportCanvasProjects([project('缺图', [{ metadata: { storageKey: 'cloud:missing' } }])]), /素材缺失/);
    assert.equal(f.saved, false);
});
