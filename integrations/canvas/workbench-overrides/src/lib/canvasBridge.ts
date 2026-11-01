import { mazalRequest } from './mazalSession'
import { ensureImageCached } from './imageCache'

export async function sendToCanvas(source: string, imageId?: string) {
  const { items } = await mazalRequest<{ items: { project: { id: string; title: string }; deleted: number | null }[] }>('/api/canvas/projects')
  const active = items.filter((item) => item.deleted == null)
  const target = await new Promise<string | null>((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.style.cssText = 'width:min(420px,90vw);padding:24px;border:1px solid #d8d2c6;border-radius:16px;background:#f8f6f0;color:#26231d'
    const title = document.createElement('h3')
    title.textContent = '添加到画布'
    const select = document.createElement('select')
    select.style.cssText = 'width:100%;padding:12px;margin:20px 0;color:inherit;background:transparent;border:1px solid #d8d2c6;border-radius:8px'
    select.add(new Option('新建画布', ''))
    for (const item of active) select.add(new Option(item.project.title, item.project.id))
    const cancel = document.createElement('button')
    cancel.textContent = '取消'
    const confirm = document.createElement('button')
    confirm.textContent = '添加并打开'
    confirm.style.cssText = 'margin-left:24px;padding:10px 18px;border:0;border-radius:8px;background:#29251f;color:#fff'
    const finish = (value: string | null) => { dialog.close(); dialog.remove(); resolve(value) }
    cancel.onclick = () => finish(null)
    confirm.onclick = () => finish(select.value)
    dialog.oncancel = (event) => { event.preventDefault(); finish(null) }
    dialog.append(title, select, cancel, confirm)
    document.body.append(dialog)
    dialog.showModal()
  })
  if (target == null) return
  const src = imageId ? await ensureImageCached(imageId) || source : source
  const blob = await (await fetch(src)).blob()
  const asset = await mazalRequest<{ id: string; width: number; height: number; bytes: number; mime: string }>('/api/canvas/assets', { method: 'POST', body: blob })
  // 上传后重新取版本，保存若冲突由服务端拒绝，不覆盖另一设备。
  const fresh = await mazalRequest<{ items: { project: Record<string, unknown> & { nodes: unknown[] }; revision: number; deleted: number | null }[] }>('/api/canvas/projects')
  const old = target ? fresh.items.find((item) => item.project.id === target && item.deleted == null) : undefined
  if (target && !old) throw new Error('目标画布已删除，图片已保存到云端作品')
  const id = target || crypto.randomUUID()
  const now = new Date().toISOString()
  const project = old?.project || { id, title: '来自创作空间', createdAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }
  const scale = Math.min(1, 480 / Math.max(asset.width, asset.height))
  const node = { id: crypto.randomUUID(), type: 'image', title: '创作空间作品', position: { x: 240 + project.nodes.length * 40, y: 200 }, width: asset.width * scale, height: asset.height * scale, metadata: { status: 'success', storageKey: 'cloud:' + asset.id, content: '', naturalWidth: asset.width, naturalHeight: asset.height, bytes: asset.bytes, mimeType: asset.mime } }
  await mazalRequest('/api/canvas/projects/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { ...project, updatedAt: now, nodes: [...project.nodes, node] }, revision: old?.revision || 0 }) })
  location.assign('/canvas/canvas/' + id)
}
