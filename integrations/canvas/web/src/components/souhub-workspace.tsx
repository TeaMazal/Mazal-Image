import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasRequest, cloudBlob, initializeCanvas, type CloudAsset, type CloudJob } from "@/services/api/souhub";
import { cloudEvents, cloudState, flushCloud, pullCloud, refreshJobs, recoverJobs } from "@/services/souhub-sync";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { restoreProjectImages } from "@/lib/canvas/canvas-import";
import { imageMetadata, createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/services/image-storage";
import { readZip } from "@/lib/zip";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasNodeData } from "@/types/canvas";

export function SouhubStatus() {
    const [, render] = useState(0);
    const [session, setSession] = useState(window.__SOUHUB_CANVAS__);
    const [open, setOpen] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    useEffect(() => {
        const update = () => render((value) => value + 1);
        cloudEvents.addEventListener("change", update);
        const refresh = () => { if (document.visibilityState === "visible") void initializeCanvas().then(setSession).catch(() => undefined); };
        const timer = setInterval(refresh, 60_000);
        window.addEventListener("mazal-balance-refresh", refresh);
        return () => { cloudEvents.removeEventListener("change", update); clearInterval(timer); window.removeEventListener("mazal-balance-refresh", refresh); };
    }, []);
    const amount = session.balance.balance ?? session.balance.quota?.remaining ?? session.balance.remaining;
    return <div className="souhub-status">
        <button title={cloudState.error || "点击重试同步"} onClick={() => void flushCloud()}>{cloudState.status}</button>
        <button onClick={() => { setOpen(!open); void initializeCanvas().then(setSession).catch(() => undefined); }}>{session.balance.balance == null ? "密钥额度" : "余额"} {amount == null ? "—" : "$" + Number(amount.toFixed(4))}</button>
        <button title="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "浅色" : "深色"}</button>
        {open && <div className="souhub-details"><p>金额单位 USD。实际扣费以主站用量为准。</p><p>云端素材 {(session.used_bytes / 1024 ** 2).toFixed(1)} MB / {(session.settings.quota_bytes / 1024 ** 3).toFixed(1)} GB</p><a href="https://ai.souhub.top" target="_blank" rel="noreferrer">查看账户与账单 ↗</a><button onClick={() => { sessionStorage.removeItem("mazal-image-key"); localStorage.removeItem("mazal-image-key"); location.assign("/canvas/"); }}>退出</button></div>}
    </div>;
}

export function SouhubLayout({ children }: { children: ReactNode }) {
    const [, render] = useState(0);
    useEffect(() => { const update = () => render((value) => value + 1); cloudEvents.addEventListener("change", update); return () => cloudEvents.removeEventListener("change", update); }, []);
    const location = useLocation();
    const compact = /^\/canvas\/[^/]+/.test(location.pathname);
    return <div className="souhub-shell">
        {!compact && <header className="souhub-header"><a href="/">Souhub Image</a><nav><Link to="/canvas">无限画布</Link><Link to="/library">云端作品</Link><Link to="/jobs">生成任务</Link>{window.__SOUHUB_CANVAS__.admin && <Link to="/admin">画布管理</Link>}</nav><SouhubStatus /></header>}
        {cloudState.error && <p className="souhub-sync-error" role="status">{cloudState.error} <button onClick={() => void flushCloud().then(() => pullCloud()).catch(() => undefined)}>重试同步</button></p>}
        <div className="souhub-content">{children}</div>
        <a className="souhub-attribution" href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">基于 infinite-canvas · basketikun · MIT</a>
    </div>;
}

export function SouhubProjects() {
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const create = useCanvasStore((state) => state.createProject);
    const [search, setSearch] = useState("");
    const [view, setView] = useState("active");
    const [, render] = useState(0);
    const [error, setError] = useState("");
    useEffect(() => { const change = () => render((value) => value + 1); cloudEvents.addEventListener("change", change); return () => cloudEvents.removeEventListener("change", change); }, []);
    async function restore(item: typeof cloudState.trash[number]) {
        try {
            const result = await canvasRequest<{ revision: number }>("/projects/" + item.project.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: item.project, revision: item.revision }) });
            if (result.revision) { await pullCloud(); setView("active"); }
        } catch (failure) { setError(String(failure)); }
    }
    async function permanentlyRemove(item: typeof cloudState.trash[number]) {
        if (!confirm("永久删除此画布？云端作品仍保留，可在作品库单独清理。")) return;
        try { await canvasRequest(`/projects/${item.project.id}?revision=${item.revision}&permanent=true`, { method: "DELETE" }); await pullCloud(); }
        catch (failure) { setError(String(failure)); }
    }
    async function importFile(file?: File) {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const manifest = zip.get("projects.json");
            if (!manifest) throw new Error("备份缺少项目文件");
            const data = JSON.parse(await manifest.text()) as CanvasExportFile;
            if (!Array.isArray(data.projects) || data.projects.some((item) => !Array.isArray(item.project?.nodes) || !Array.isArray(item.project?.connections) || !Array.isArray(item.files))) throw new Error("项目备份格式无效");
            for (const item of data.projects) {
                useCanvasStore.getState().importProject(await restoreProjectImages(item, zip));
            }
            void flushCloud();
        } catch (failure) { setError("导入失败：" + String(failure)); }
    }
    const visible = projects.filter((project) => Boolean(project.archived) === (view === "archived") && project.title.toLowerCase().includes(search.toLowerCase()));
    return <main className="souhub-library"><div className="souhub-library-title"><div><small>图片创作工作台</small><h1>无限画布</h1><p>把参考图、灵感和生成结果放在一起，继续探索你的方案。</p></div><div className="souhub-actions"><label className="souhub-button">导入项目<input type="file" accept=".zip" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label><button className="souhub-primary" onClick={() => navigate("/canvas/" + create("未命名画布"))}>＋ 新建画布</button></div></div>
        <div className="souhub-project-filters"><input aria-label="搜索画布" placeholder="搜索画布名称…" value={search} onChange={(event) => setSearch(event.target.value)} /><div>{[["active", "我的画布"], ["archived", "已归档"], ["trash", "回收站"]].map(([id, title]) => <button key={id} data-active={view === id} onClick={() => { setView(id); if (id === "trash") void flushCloud().then(() => pullCloud()).catch((failure) => setError(String(failure))); }}>{title}</button>)}</div></div>
        {error && <p role="alert">{error}</p>}
        <div className="souhub-project-grid">{view === "trash" ? cloudState.trash.map((item) => <article key={item.project.id}><h2>{item.project.title}</h2><p>删除后保留 {window.__SOUHUB_CANVAS__.settings.trash_days} 天</p><button onClick={() => void restore(item)}>恢复画布</button><button onClick={() => void permanentlyRemove(item)}>永久删除</button></article>) : visible.map((project) => <article key={project.id}><button className="souhub-project-open" onClick={() => navigate("/canvas/" + project.id)}><h2>{project.title}</h2><p>{project.nodes.length} 个元素 · {new Date(project.updatedAt).toLocaleString()}</p></button><div className="souhub-actions">
            <button onClick={() => { const title = prompt("画布名称", project.title); if (title?.trim()) useCanvasStore.getState().renameProject(project.id, title); }}>重命名</button>
            <button onClick={() => useCanvasStore.getState().importProject({ ...project, title: project.title + " · 副本" })}>复制</button>
            <button onClick={() => useCanvasStore.setState({ projects: projects.map((item) => item.id === project.id ? { ...item, archived: !item.archived, updatedAt: new Date().toISOString() } : item) })}>{project.archived ? "取消归档" : "归档"}</button>
            <button onClick={() => void exportCanvasProjects([project], project.title).catch((failure) => setError(String(failure)))}>导出</button>
            <button onClick={() => { if (confirm("移入回收站？运行中的生成不会取消，历史账单保留。")) useCanvasStore.getState().deleteProjects([project.id]); }}>删除</button>
        </div></article>)}</div>
        {view !== "trash" && !visible.length && <div className="souhub-empty">{search ? "没有找到匹配的画布" : "新建一张画布，从文字或参考图开始。"}</div>}
    </main>;
}

function AssetPreview({ asset }: { asset: CloudAsset }) {
    const [url, setUrl] = useState("");
    const ref = useRef<HTMLImageElement>(null);
    useEffect(() => {
        let live = true; let objectUrl = "";
        const observer = new IntersectionObserver((entries) => { if (!entries.some((entry) => entry.isIntersecting)) return; observer.disconnect(); void cloudBlob(asset.id, true).then((blob) => { objectUrl = URL.createObjectURL(blob); if (live) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl); }).catch(() => undefined); }, { rootMargin: "200px" });
        if (ref.current) observer.observe(ref.current);
        return () => { live = false; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [asset.id]);
    return <img ref={ref} src={url || undefined} alt="云端作品" loading="lazy" />;
}

export function SouhubAssets() {
    const [assets, setAssets] = useState<CloudAsset[]>([]);
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const [target, setTarget] = useState("");
    const refresh = () => canvasRequest<{ items: CloudAsset[] }>("/assets").then((result) => setAssets(result.items)).catch((failure) => setError(String(failure)));
    useEffect(() => { void refresh(); }, []);
    async function insert(asset: CloudAsset) {
        try {
            const image = await uploadImage(await cloudBlob(asset.id));
            const id = target || useCanvasStore.getState().createProject("作品画布");
            const project = useCanvasStore.getState().openProject(id)!;
            const node = createCanvasNode("image", { x: 300 + project.nodes.length * 40, y: 250 }, imageMetadata(image));
            useCanvasStore.getState().updateProject(id, { nodes: [...project.nodes, node] });
            await flushCloud(); navigate("/canvas/" + id);
        } catch (failure) { setError(String(failure)); }
    }
    return <main className="souhub-library"><div className="souhub-library-title"><div><h1>云端作品</h1><p>保存上传素材与画布生成结果，同一用户换设备后仍可访问。</p></div><select aria-label="目标画布" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">添加到新画布</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></div>{error && <p role="alert">{error}</p>}<div className="souhub-asset-grid">{assets.map((asset) => <article key={asset.id}><AssetPreview asset={asset} /><p>{asset.width} × {asset.height} · {(asset.bytes / 1024 ** 2).toFixed(1)} MB</p><div className="souhub-actions"><button onClick={() => void insert(asset)}>添加到画布</button><a className="souhub-button" href={"/?canvasAsset=" + asset.id}>在对话中使用 ↗</a><button onClick={() => void cloudBlob(asset.id).then((blob) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "souhub-" + asset.id.slice(0, 12) + (asset.mime === "image/jpeg" ? ".jpg" : asset.mime === "image/webp" ? ".webp" : ".png"); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>下载</button><button onClick={() => { if (confirm("删除未被引用的云端素材？")) void canvasRequest("/assets/" + asset.id, { method: "DELETE" }).then(refresh).catch((failure) => setError(String(failure))); }}>删除</button></div></article>)}</div></main>;
}

export function SouhubJobs() {
    const [, render] = useState(0);
    const navigate = useNavigate();
    useEffect(() => { const change = () => render((value) => value + 1); cloudEvents.addEventListener("change", change); void refreshJobs(); return () => cloudEvents.removeEventListener("change", change); }, []);
    const labels: Record<string, string> = { submitting: "提交中", queued: "排队中", running: "生成中", success: "已完成", error: "失败", uncertain: "提交待确认", saving: "图片已生成，保存处理中" };
    async function open(job: CloudJob) {
        const project = useCanvasStore.getState().openProject(job.project_id);
        if (!project) { navigate("/library"); return; }
        const recovered = await recoverJobs(project);
        useCanvasStore.getState().updateProject(project.id, { nodes: recovered.nodes });
        navigate("/canvas/" + project.id);
    }
    return <main className="souhub-library"><h1>生成任务</h1><p>关闭页面不会取消已经提交的任务。连接异常时先查询原任务，实际费用以主站账单为准。</p>{cloudState.jobs.map((job) => <article className="souhub-job" key={job.id}><div><strong>{labels[job.status] || job.status}</strong><p>{job.prompt}</p><small>{new Date(job.created * 1000).toLocaleString()} · {job.params.size} · 密钥 #{job.key_id} · 任务 {job.id}</small>{job.error && <p role="status">{job.error}</p>}</div><button onClick={() => void open(job)}>查看结果</button></article>)}</main>;
}

export function SouhubAdmin() {
    const [data, setData] = useState<{ settings: { enabled: boolean; quota_bytes: number; trash_days: number }; users: number; assets: number; bytes: number; projects: number }>();
    const [message, setMessage] = useState("");
    useEffect(() => { void canvasRequest<typeof data>("/admin").then(setData).catch((failure) => setMessage(String(failure))); }, []);
    if (!data) return <main className="souhub-library">{message || "读取设置…"}</main>;
    return <main className="souhub-library"><h1>画布管理</h1><p>账号池继续在绘图站管理后台维护。</p><p>{data.users} 位用户 · {data.projects} 个项目 · {data.assets} 个素材 · {(data.bytes / 1024 ** 3).toFixed(2)} GB</p><form className="souhub-admin-form" onSubmit={(event) => { event.preventDefault(); void canvasRequest("/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.settings) }).then(() => setMessage("设置已保存")).catch((failure) => setMessage(String(failure))); }}><label><input type="checkbox" checked={data.settings.enabled} onChange={(event) => setData({ ...data, settings: { ...data.settings, enabled: event.target.checked } })} /> 开放画布生成</label><label>每位用户素材额度（GB）<input type="number" min="0.1" step="0.1" value={data.settings.quota_bytes / 1024 ** 3} onChange={(event) => setData({ ...data, settings: { ...data.settings, quota_bytes: Math.round(Number(event.target.value) * 1024 ** 3) } })} /></label><label>回收站保留天数<input type="number" min="1" value={data.settings.trash_days} onChange={(event) => setData({ ...data, settings: { ...data.settings, trash_days: Number(event.target.value) } })} /></label><button className="souhub-primary" type="submit">保存</button><p role="status">{message}</p></form></main>;
}
