import type { CanvasProject, CanvasDeletedProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";
import type { CloudJob } from "./api/souhub";
export type CloudProject = { project: CanvasProject; revision: number; deleted: number | null };
export type SyncBase = { revision: number; snapshot: string };
export const snapshot = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "string" && item.startsWith("blob:") ? "" : item);
export function mergeProjects(local: CanvasProject[], deleted: CanvasDeletedProject[], remote: CloudProject[], oldBases: Record<string, SyncBase>, newId: () => string) {
    const bases = { ...oldBases };
    const projects: CanvasProject[] = [];
    const pending = [...deleted];
    const copies: { from: string; to: string }[] = [];
    const fork = (project: CanvasProject) => {
        const copy = { ...project, id: newId(), title: project.title + " · 冲突副本" };
        projects.push(copy); copies.push({ from: project.id, to: copy.id });
    };
    for (const item of remote) {
        const id = item.project.id;
        const mine = local.find((project) => project.id === id);
        const base = bases[id];
        const tombstone = pending.findIndex((entry) => entry.id === id);
        if (tombstone >= 0 && item.deleted == null && base?.revision === item.revision) continue;
        if (tombstone >= 0) pending.splice(tombstone, 1);
        const dirty = mine && base?.snapshot !== snapshot(mine);
        if (dirty && (!base || base.revision !== item.revision)) fork(mine);
        const keepLocal = mine && item.deleted == null && base?.revision === item.revision;
        if (item.deleted == null) projects.push(keepLocal ? mine : item.project);
        bases[id] = { revision: item.revision, snapshot: keepLocal && base ? base.snapshot : snapshot(item.project) };
    }
    for (const mine of local) {
        if (remote.some((item) => item.project.id === mine.id)) continue;
        const base = bases[mine.id];
        if (!base) projects.push(mine);
        else if (base.snapshot !== snapshot(mine)) fork(mine);
        delete bases[mine.id];
    }
    const changedIds = [...new Set([...local.map((p) => p.id), ...projects.map((p) => p.id)])].filter((id) => snapshot(local.find((p) => p.id === id)) !== snapshot(projects.find((p) => p.id === id)));
    return { projects, deleted: pending, bases, changedIds, copies };
}
export async function recoverNodeJobs(node: CanvasNodeData, allJobs: CloudJob[], load: (job: CloudJob) => Promise<Pick<CanvasNodeImage, "content" | "storageKey" | "naturalWidth" | "naturalHeight" | "bytes" | "mimeType">>): Promise<CanvasNodeData> {
    if (!node.metadata) return node;
    const jobs = allJobs.filter((job) => job.node_id === node.id).sort((a,b) => b.created - a.created);
    const metadata = node.metadata;
    let changed = false;
    async function recover<T extends { canvasJobId?: string; status?: string; storageKey?: string; content?: string }>(image: T, imageId?: string): Promise<T> {
        const job = jobs.find((item) => image.canvasJobId ? item.id === image.canvasJobId : image.status === "loading" && (imageId ? item.image_id === imageId : item.image_id === "unassigned"));
        if (!job || (image.status === "success" && image.storageKey)) return image;
        if (job.status === "success" && job.asset_id) {
            const result = await load(job); changed = true;
            return { ...image, ...result, status: "success", errorDetails: undefined };
        }
        if (job.status === "error" && (image.status !== "error" || (image as {errorDetails?:string}).errorDetails !== job.error)) {
            changed = true; return { ...image, status: "error", errorDetails: job.error };
        }
        return image;
    }
    const images = metadata.images ? await Promise.all(metadata.images.map((image) => recover(image, image.id))) : undefined;
    let next = images ? { ...metadata, images } : await recover(metadata);
    if (images && changed) {
        const primary = images.find((image) => image.id === metadata.primaryImageId && image.status === "success") || images.find((image) => image.status === "success");
        if (primary && (!metadata.storageKey || !metadata.primaryImageId)) next = { ...next, ...primary, primaryImageId: primary.id };
        next.status = images.some((image) => image.status === "loading") ? "loading" : images.some((image) => image.status === "success") ? "success" : "error";
    }
    return changed ? { ...node, metadata: next } : node;
}
