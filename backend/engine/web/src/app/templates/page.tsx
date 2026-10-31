"use client";

import { useEffect, useRef, useState } from "react";
import { httpRequest } from "@/lib/request";
import { useAuthGuard } from "@/lib/use-auth-guard";

type Field = { key: string; label: string; default: string; placeholder: string; required: boolean };
type Template = {
  id: string; title: string; description: string; category: string; tags: string[];
  cover: string; prompt: string; fields: Field[]; reference_required: boolean;
  published: boolean; order: number; size: string; model: string;
  source_name: string; source_url: string; license: string; preview_note: string;
};
type Library = { revision: number; categories: string[]; templates: Template[] };
const control = "w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 dark:border-white/15 dark:bg-stone-900 dark:text-stone-100";
const button = "rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/15";

export default function TemplatesPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [original, setOriginal] = useState("");
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState("");
  const editor = useRef<HTMLFieldSetElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const dirty = Boolean(draft && (JSON.stringify(draft) !== original || tagsText !== draft.tags.join(", ")));
  const load = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setMessage("");
    try { setLibrary(await httpRequest<Library>("/api/admin/template-library")); setFailed(false); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "加载失败"); }
    finally { locked.current = false; setBusy(false); }
  };
  useEffect(() => { if (session?.role === "admin") void load(); }, [session]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const choose = (item: Template, creating = false) => {
    if (locked.current) return;
    if (dirty && !window.confirm("当前模板尚未保存，放弃修改？")) return;
    setDraft(structuredClone(item)); setOriginal(creating ? "" : JSON.stringify(item)); setOriginalId(creating ? null : item.id); setTagsText(item.tags.join(", ")); setMessage("");
    requestAnimationFrame(() => { if (window.matchMedia("(max-width: 1023px)").matches) editor.current?.scrollIntoView({ block: "start", behavior: "smooth" }); });
  };
  const update = (patch: Partial<Template>) => { if (draft) setDraft({ ...draft, ...patch }); };
  const save = async () => {
    if (!draft || !library || locked.current) return;
    const tags = [...new Set(tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
    const invalid = !/^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.id) ? "编号只能使用小写字母、数字和连字符。"
      : !originalId && library.templates.some((item) => item.id === draft.id) ? "该编号已存在，请为新模板换一个编号。"
      : !draft.title.trim() || !draft.prompt.trim() ? "请填写标题和完整提示词。"
      : tags.length > 8 || tags.some((tag) => tag.length > 24) ? "标签最多 8 个，每个最多 24 字。"
      : new Set(draft.fields.map((field) => field.key)).size !== draft.fields.length || draft.fields.some((field) => !/^[a-z][a-z0-9_]{0,31}$/.test(field.key) || !field.label.trim()) ? "填写项编号不能重复，仅支持小写英文、数字和下划线；显示名称不能为空。" : "";
    if (invalid) { setFailed(true); setMessage(invalid); return; }
    locked.current = true;
    setBusy(true); setMessage("");
    try {
      const result = await httpRequest<{ revision: number; template: Template }>(`/api/admin/template-library/${encodeURIComponent(draft.id)}`, { method: "PUT", body: { revision: library.revision, expected_exists: originalId !== null, template: { ...draft, tags } } });
      setLibrary({ ...library, revision: result.revision, templates: [...library.templates.filter((item) => item.id !== result.template.id), result.template] });
      setDraft(result.template); setOriginal(JSON.stringify(result.template)); setOriginalId(result.template.id); setTagsText(result.template.tags.join(", ")); setFailed(false); setMessage(result.template.published ? "已保存并发布，用户重新打开模板中心即可看到。" : "已保存为下架状态，用户端不可见。");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { locked.current = false; setBusy(false); }
  };
  const upload = async (file: File) => {
    if (locked.current) return;
    if (file.size > 2 * 1024 * 1024) { setFailed(true); setMessage("封面不能超过 2 MB"); return; }
    locked.current = true;
    setBusy(true); setMessage("");
    try {
      const result = await httpRequest<{ cover: string }>("/api/admin/template-library/cover", { method: "POST", body: file, headers: { "Content-Type": file.type } });
      update({ cover: result.cover }); setFailed(false); setMessage("封面已上传，保存模板后生效。");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "上传失败"); }
    finally { locked.current = false; setBusy(false); }
  };
  if (isCheckingAuth) return <p className="p-8 text-sm">正在验证管理权限…</p>;
  if (session?.role !== "admin") return null;
  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 text-stone-800 dark:text-stone-100">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">灵感模板管理</h1><p className="mt-2 text-sm text-stone-500">管理用户工作台的模板内容、封面与上下架。不会调用生图或修改账号池。</p></div><div className="flex gap-2"><button disabled={busy} className={button} onClick={() => { if (!dirty || window.confirm("刷新将放弃未保存的修改，继续？")) { setDraft(null); void load(); } }}>刷新模板库</button><button disabled={busy || !library} className={button} onClick={() => choose({ id: `template-${Date.now()}`, title: "新模板", description: "", category: library?.categories[0] || "电商商品", tags: [], cover: "", prompt: "创作主题：{{subject}}。", fields: [{ key: "subject", label: "创作主题", default: "", placeholder: "描述你的主体", required: true }], reference_required: false, published: false, order: 100, size: "auto", model: "gpt-image-2", source_name: "本站原创", source_url: "", license: "本站原创", preview_note: "风格示例，实际结果以生成效果为准。" }, true)}>＋ 新建模板</button></div></header>
    {message && !draft && <p role={failed ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${failed ? "border-red-200 text-red-700" : "border-stone-200"}`}>{message}</p>}
    <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-3"><input className={control} aria-label="搜索模板" placeholder="搜索标题或分类" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="max-h-[30vh] lg:max-h-[75vh] space-y-1 overflow-y-auto">{library?.templates.filter((item) => `${item.title} ${item.category}`.includes(query)).sort((a, b) => a.order - b.order).map((item) => <button key={item.id} disabled={busy} className={`w-full rounded-xl border p-3 text-left ${draft?.id === item.id ? "border-stone-800 bg-stone-100 dark:border-stone-400 dark:bg-white/10" : "border-transparent"}`} onClick={() => choose(item)}><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-stone-500">{item.category} · {item.published ? "已上架" : "已下架"} · 排序 {item.order}</span></button>)}</div>{!library && !busy && <button className={button} onClick={() => void load()}>重新加载</button>}</aside>
      {draft ? <fieldset ref={editor} disabled={busy} className="min-w-0 space-y-5 rounded-2xl border border-stone-200 p-5 dark:border-white/10">
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-xs">标题<input className={control} maxLength={60} value={draft.title} onChange={(event) => update({ title: event.target.value })} /></label><label className="space-y-2 text-xs">编号（保存后不可改）<input className={control} value={draft.id} disabled={originalId !== null} onChange={(event) => update({ id: event.target.value })} /></label><label className="space-y-2 text-xs">分类<select className={control} value={draft.category} onChange={(event) => update({ category: event.target.value })}>{library?.categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="space-y-2 text-xs">排序（越小越靠前）<input className={control} type="number" min={0} max={10000} value={draft.order} onChange={(event) => update({ order: Number(event.target.value) })} /></label></div>
        <label className="block space-y-2 text-xs">简短说明<textarea className={control} maxLength={240} value={draft.description} onChange={(event) => update({ description: event.target.value })} /></label>
        <div className="flex flex-wrap items-center gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.published} onChange={(event) => update({ published: event.target.checked })} />上架到用户端</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.reference_required} onChange={(event) => update({ reference_required: event.target.checked })} />需要主体参考图</label><label>建议尺寸 <select className={control} value={draft.size} onChange={(event) => update({ size: event.target.value })}>{["auto", "1024x1024", "1024x1536", "1536x1024"].map((size) => <option key={size}>{size}</option>)}</select></label></div>
        <div className="flex flex-wrap items-start gap-4">{draft.cover && <img src={draft.cover} alt="模板封面" className="h-32 w-28 rounded-lg object-cover" />} {draft.cover && <button className={button} onClick={() => update({ cover: "" })}>移除封面</button>}<label className="space-y-2 text-xs">模板封面（PNG / JPG / WebP，最大 2 MB）<input className={control} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /><span className="block text-stone-500">请使用有权展示的图片，来源与许可填写在下方。</span></label></div>
        <div className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-medium">用户填写项（最多 8 个）</h2><button className={button} disabled={draft.fields.length >= 8} onClick={() => update({ fields: [...draft.fields, { key: `field_${Array.from({ length: 9 }, (_, index) => index + 1).find((index) => !draft.fields.some((field) => field.key === `field_${index}`))}`, label: "新填写项", default: "", placeholder: "", required: false }] })}>＋ 填写项</button></div>{draft.fields.map((field, index) => <div key={index} className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-white/10"><div className="grid gap-2 sm:grid-cols-2">{([['key', '变量编号（英文）'], ['label', '显示名称'], ['default', '默认值'], ['placeholder', '输入提示']] as const).map(([key, title]) => <label className="space-y-1 text-xs" key={key}>{title}<input className={control} maxLength={key === "key" ? 32 : key === "label" ? 40 : key === "default" ? 500 : 120} value={field[key]} onChange={(event) => update({ fields: draft.fields.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item) })} /></label>)}</div><div className="flex items-center justify-between text-xs"><label><input type="checkbox" checked={field.required} onChange={(event) => update({ fields: draft.fields.map((item, i) => i === index ? { ...item, required: event.target.checked } : item) })} /> 必填</label><button onClick={() => update({ fields: draft.fields.filter((_, i) => i !== index) })}>移除填写项</button></div></div>)}</div>
        <label className="block space-y-2 text-xs">完整提示词（使用双花括号插入变量，如 {"{{subject}}"}）<textarea rows={9} maxLength={12000} className={control} value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2">{([['source_name', '作者 / 来源名称'], ['source_url', '来源链接（http / https）'], ['license', '许可说明'], ['preview_note', '示例效果说明']] as const).map(([key, title]) => <label key={key} className="space-y-2 text-xs">{title}<input className={control} value={draft[key]} onChange={(event) => update({ [key]: event.target.value })} /></label>)}</div>
        <label className="block space-y-2 text-xs">搜索标签（逗号分隔）<input className={control} value={tagsText} placeholder="例如：商品, 极简, 海报" onChange={(event) => setTagsText(event.target.value)} /></label>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-4 border-t border-stone-200 bg-stone-50 py-4 dark:border-white/10 dark:bg-stone-900"><button className="rounded-lg bg-stone-900 px-5 py-2 text-sm text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900" disabled={!dirty} onClick={() => void save()}>{busy ? "正在保存…" : "保存模板"}</button><span className="text-xs text-stone-500">{dirty ? "有未保存的修改" : "已保存"} · 版本 {library?.revision}</span>{message && <p role={failed ? "alert" : "status"} className={`w-full text-sm ${failed ? "text-red-700 dark:text-red-300" : "text-stone-600 dark:text-stone-300"}`}>{message}</p>}</div>
      </fieldset> : <p className="rounded-2xl border border-dashed border-stone-200 p-12 text-center text-sm text-stone-500">{busy ? "正在加载模板…" : "选择左侧模板进行编辑，或新建模板。"}</p>}
    </div>
  </main>;
}
