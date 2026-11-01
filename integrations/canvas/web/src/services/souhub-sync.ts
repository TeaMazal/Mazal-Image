import localforage from "localforage";
import { nanoid } from "nanoid";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { canvasRequest, CloudError, cloudBlob, type CloudJob, uploadCloudBlob } from "@/services/api/souhub";
import { recoverNodeJobs, mergeProjects, snapshot, type CloudProject, type SyncBase } from "./souhub-sync-state";

let bases: Record<string, SyncBase> = {};
const baseKey = "souhub-sync-base:" + window.__SOUHUB_CANVAS__.owner;
export const cloudState = { status: "正在同步", error: "", jobs: [] as CloudJob[], trash: [] as CloudProject[], busy: false };
export const cloudEvents = new EventTarget();
let paused = false;
let timer: ReturnType<typeof setTimeout>;
let syncTail = Promise.resolve();
function synchronize(operation: () => Promise<void>) {
    const next = syncTail.then(operation);
    syncTail = next.catch(() => undefined);
    return next;
}
function announce(status: string, error = "") {
    Object.assign(cloudState, { status, error });
    cloudEvents.dispatchEvent(new Event("change"));
}
const persistBase = () => localforage.setItem(baseKey, bases);
const uploaded = new Map<string, Promise<string>>();
async function storedKey(key: string) {
    if (key.startsWith("cloud:")) return key;
    if (!uploaded.has(key)) uploaded.set(key, (async () => {
        const blob = await getImageBlob(key);
        if (!blob) throw new Error("本地素材缺失，请保留副本并检查图片");
        return "cloud:" + (await uploadCloudBlob(blob)).id;
    })().catch((error) => { uploaded.delete(key); throw error; }));
    return uploaded.get(key)!;
}
async function materialize(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(materialize));
    if (!value || typeof value !== "object") {
        if (typeof value === "string" && value.startsWith("image:")) return storedKey(value);
        return typeof value === "string" && value.startsWith("blob:") ? "" : value;
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) result[key] = await materialize(item);
    if (typeof source.storageKey === "string") result.storageKey = await storedKey(source.storageKey);
    for (const key of ["content", "dataUrl", "coverUrl"]) {
        if (typeof source[key] === "string" && (source[key] as string).startsWith("data:image/")) {
            result.storageKey = "cloud:" + (await uploadCloudBlob(await (await fetch(source[key] as string)).blob())).id;
            result[key] = "";
        }
    }
    return result;
}
export function pullCloud() { return synchronize(readCloud); }
async function readCloud() {
    const { items } = await canvasRequest<{ items: CloudProject[] }>("/projects");
    const state = useCanvasStore.getState();
    const merged = mergeProjects(state.projects, state.deletedProjects, items, bases, nanoid);
    paused = true;
    bases = merged.bases;
    cloudState.trash = items.filter((item) => item.deleted != null);
    if (merged.changedIds.length || merged.deleted.length !== state.deletedProjects.length) state.replaceProjects(merged.projects, merged.deleted);
    paused = false;
    await persistBase();
    if (merged.changedIds.length) window.dispatchEvent(new CustomEvent("souhub-projects-loaded", { detail: { ids: merged.changedIds, copies: merged.copies } }));
    announce("已同步", merged.copies.length ? "另一设备更新了画布，本机修改已保留为“冲突副本”，可在项目列表查看。" : "");
}
export function flushCloud(): Promise<void> {
    if (paused) return Promise.resolve();
    return synchronize(saveCloud);
}
async function saveCloud() {
    cloudState.busy = true;
    announce(navigator.onLine ? "保存中" : "离线待同步");
    try {
        const state = useCanvasStore.getState();
        for (const project of state.projects) {
            const localSnapshot = snapshot(project);
            if (bases[project.id]?.snapshot === localSnapshot) continue;
            const revision = bases[project.id]?.revision || 0;
            const remote = await materialize(project) as CanvasProject;
            try {
                const result = await canvasRequest<{ revision: number }>("/projects/" + project.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: remote, revision }) });
                bases[project.id] = { revision: result.revision, snapshot: localSnapshot };
                await persistBase();
            } catch (error) {
                if (error instanceof CloudError && error.status === 409) {
                    await readCloud();
                    throw new Error("保存发生冲突，修改已保留为副本。请返回项目列表确认后同步。");
                }
                throw error;
            }
        }
        for (const deleted of state.deletedProjects) {
            const base = bases[deleted.id];
            if (base) {
                try { await canvasRequest(`/projects/${deleted.id}?revision=${base.revision}`, { method: "DELETE" }); }
                catch (error) { if (!(error instanceof CloudError) || ![404,409].includes(error.status)) throw error; await readCloud(); throw new Error("项目已被其他设备修改，请确认后重新删除"); }
            }
            delete bases[deleted.id];
            paused = true;
            useCanvasStore.setState((current) => ({ deletedProjects: current.deletedProjects.filter((item) => item.id !== deleted.id) }));
            paused = false;
            await persistBase();
        }
        announce("已保存");
    } catch (error) {
        announce(navigator.onLine ? "同步失败" : "离线待同步", error instanceof Error ? error.message : "同步失败，本地修改已保留");
    } finally { cloudState.busy = false; }
}
export async function refreshJobs() {
    cloudState.jobs = (await canvasRequest<{ items: CloudJob[] }>("/jobs")).items;
    cloudEvents.dispatchEvent(new Event("jobs"));
    cloudEvents.dispatchEvent(new Event("change"));
}
export async function recoverJobs(project: CanvasProject): Promise<CanvasProject> {
    const jobs = cloudState.jobs.filter((job) => job.project_id === project.id);
    const nodes = await Promise.all(project.nodes.map((node) => recoverNodeJobs(node, jobs, async (job) => {
        const storageKey = "cloud:" + job.asset_id;
        const blob = await getImageBlob(storageKey) || await cloudBlob(job.asset_id);
        const content = await setImageBlob(storageKey, blob);
        const bitmap = await createImageBitmap(blob);
        const image = { content, storageKey, naturalWidth: bitmap.width, naturalHeight: bitmap.height, bytes: blob.size, mimeType: blob.type };
        bitmap.close();
        return image;
    })));
    return { ...project, nodes };
}
export async function startCloudSync() {
    await useCanvasStore.persist.rehydrate();
    if (!useCanvasStore.getState().hydrated) throw new Error("浏览器存储暂不可用，请检查存储权限后刷新；原有云端画布保留");
    document.getElementById("root")!.textContent = "正在同步云端画布…";
    bases = (await localforage.getItem<Record<string, SyncBase>>(baseKey)) || {};
    try { await pullCloud(); await refreshJobs(); }
    catch (error) { announce("离线待同步", "连接云端失败，本地修改已保留：" + String(error)); }
    useCanvasStore.subscribe((state, previous) => {
        if (paused || (state.projects === previous.projects && state.deletedProjects === previous.deletedProjects)) return;
        clearTimeout(timer); announce("保存中"); timer = setTimeout(() => void flushCloud(), 1000);
    });
    window.addEventListener("online", () => void flushCloud().then(pullCloud).catch((error) => announce("同步失败", String(error))));
    window.addEventListener("focus", () => void flushCloud().then(pullCloud).catch((error) => announce("同步失败", String(error))));
    window.addEventListener("beforeunload", (event) => {
        if (useCanvasStore.getState().projects.some((project) => bases[project.id]?.snapshot !== snapshot(project)) || useCanvasStore.getState().deletedProjects.length) { event.preventDefault(); event.returnValue = ""; }
    });
    setInterval(() => { if (document.visibilityState === "visible") void refreshJobs().catch(() => undefined); }, 3000);
    void flushCloud();
}
