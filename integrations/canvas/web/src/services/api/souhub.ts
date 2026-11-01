export type CanvasSession = { owner: string; key_id: number; admin: boolean; balance: { balance: number | null; quota?: { remaining: number }; remaining?: number }; settings: { enabled: boolean; quota_bytes: number; trash_days: number }; used_bytes: number };
export type CloudAsset = { id: string; bytes: number; mime: string; width: number; height: number };
export type CloudJob = { id: string; project_id: string; node_id: string; image_id: string; status: string; prompt: string; asset_id: string; error: string; created: number; key_id: number; params: { size: string; quality: string; model: string } };

declare global { interface Window { __SOUHUB_CANVAS__: CanvasSession } }

export function canvasKey() {
    return sessionStorage.getItem("mazal-image-key") || localStorage.getItem("mazal-image-key") || "";
}

export class CloudError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

export async function canvasRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch("/api/canvas" + path, { ...init, cache: "no-store", headers: { Authorization: "Bearer " + canvasKey(), ...init.headers }, signal: init.signal ?? AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new CloudError(typeof body.detail === "string" ? body.detail : "画布服务请求失败", response.status);
    return body as T;
}

export async function cloudBlob(id: string, thumbnail = false) {
    const response = await fetch(`/api/canvas/assets/${encodeURIComponent(id)}${thumbnail ? "?thumbnail=true" : ""}`, { cache: "no-store", headers: { Authorization: "Bearer " + canvasKey() } });
    if (!response.ok) throw new Error("素材加载失败，请重新登录或稍后重试");
    return response.blob();
}

export function uploadCloudBlob(blob: Blob) {
    return canvasRequest<CloudAsset>("/assets", { method: "POST", body: blob });
}
let priceCache: { at: number; prices: Record<string, number>; key: string } | undefined;
export async function fetchCanvasPricing() {
    if (priceCache && priceCache.key === canvasKey() && Date.now() - priceCache.at < 60_000) return priceCache.prices;
    const response = await fetch("/v1/sub2api/image-pricing", { headers: { Authorization: "Bearer " + canvasKey() }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!response.ok || data.model !== "gpt-image-2" || data.currency !== "USD" || !["1K", "2K", "4K"].every((tier) => Number.isFinite(data.prices?.[tier]) && data.prices[tier] >= 0)) throw new Error("价格暂不可用");
    const prices = Object.fromEntries(["1K", "2K", "4K"].map((tier) => [tier, data.prices[tier]]));
    priceCache = { at: Date.now(), key: canvasKey(), prices };
    return prices;
}

export async function initializeCanvas() {
    const current = await canvasRequest<CanvasSession>("/session");
    window.__SOUHUB_CANVAS__ = current;
    return current;
}

let activeRequests = 0;
const waiting: (() => void)[] = [];
export async function requestCanvasImage(prompt: string, config: { size?: string; quality?: string }, images: string[], context?: { projectId: string; nodeId: string; imageId?: string }, signal?: AbortSignal) {
    // 多图逐张提交，始终只占用两个活动名额；尚未提交的取消不会扣费。
    if (activeRequests >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    activeRequests++;
    try {
        if (signal?.aborted) throw new DOMException("已停止排队", "AbortError");
        return await runCanvasImage(prompt, config, images, context, signal);
    } finally {
        activeRequests--;
        waiting.shift()?.();
    }
}

async function runCanvasImage(prompt: string, config: { size?: string; quality?: string }, images: string[], context?: { projectId: string; nodeId: string; imageId?: string }, signal?: AbortSignal) {
    const assets: string[] = [];
    for (const image of images) {
        if (signal?.aborted) throw new DOMException("查询已暂停，任务仍可在任务列表中查看", "AbortError");
        const response = await fetch(image);
        assets.push((await uploadCloudBlob(await response.blob())).id);
    }
    const id = crypto.randomUUID();
    window.dispatchEvent(new CustomEvent("souhub-job-submitted", { detail: { ...context, jobId: id } }));
    const payload = { project_id: context?.projectId || "unassigned", node_id: context?.nodeId || "unassigned", image_id: context?.imageId || "unassigned", prompt, size: config.size || "auto", quality: config.quality || "auto", assets };
    // 提交响应丢失时仅查询这个编号，不重新发起生成。
    try {
        const job = await canvasRequest<CloudJob>("/jobs/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (job.status === "error") throw new CloudError(job.error, 400);
    } catch (error) {
        if (error instanceof CloudError && error.status < 500) throw error;
    }
    window.dispatchEvent(new Event("souhub-jobs-changed"));
    let failures = 0;
    while (!signal?.aborted) {
        const result = await canvasRequest<{ items: CloudJob[] }>("/jobs").catch((error) => {
            if (error instanceof CloudError && error.status < 500) throw error;
            if (++failures >= 3) throw new Error("连接中断，原任务会继续，请在生成任务中查询，勿重复提交");
            return null;
        });
        if (result) failures = 0;
        const job = result?.items.find((item) => item.id === id);
        if (job?.status === "error") throw new Error(job.error);
        if (job?.status === "success" && job.asset_id) {
            const { setImageBlob } = await import("@/services/image-storage");
            const url = await setImageBlob("cloud:" + job.asset_id, await cloudBlob(job.asset_id));
            window.dispatchEvent(new Event("mazal-balance-refresh"));
            return [{ id, dataUrl: url }];
        }
        if (job?.status === "uncertain") throw new Error("提交结果待确认，请在任务列表查询原任务，勿重复生成");
        if (result && !job) throw new Error("未查到提交记录，请稍后查看生成任务确认；此次未自动重发");
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new DOMException("查询已暂停，任务仍可在任务列表中查看", "AbortError");
}
