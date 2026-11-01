import { nanoid } from "nanoid";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export async function restoreProjectImages(item: CanvasExportFile["projects"][number], zip: Map<string, Blob>) {
    const keys = new Map<string, string>();
    for (const asset of item.files) {
        const blob = zip.get(asset.path);
        if (!blob || !/^(image|cloud):/.test(asset.storageKey)) throw new Error("项目图片备份不完整或类型不受支持");
        const key = "image:" + nanoid();
        await setImageBlob(key, blob.slice(0, blob.size, asset.mimeType));
        keys.set(asset.storageKey, key);
    }
    // 导入的图片属于当前用户；重新上传确认归属，不沿用导出者的云端引用。
    return JSON.parse(JSON.stringify(item.project, (_name, value) => {
        if (typeof value !== "string") return value;
        if (keys.has(value)) return keys.get(value);
        if (value.startsWith("blob:")) return "";
        if (/^(image|cloud):/.test(value)) throw new Error("项目备份缺少图片，请重新完整导出");
        return value;
    })) as CanvasProject;
}
