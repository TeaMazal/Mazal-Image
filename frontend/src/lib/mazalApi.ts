import type { TaskParams } from '../types'
import { dataUrlToBlob } from './canvasImage'
import { fetchImageUrlAsDataUrl, normalizeBase64Image, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { mazalRequest } from './mazalSession'

export interface MazalTask {
  id: string
  status: 'queued' | 'running' | 'success' | 'error'
  error?: string
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
}

export const mazalTaskEvents = new EventTarget()
export const mazalTaskStates = new Map<string, MazalTask['status']>()

export async function pollMazalTask(id: string, _params?: TaskParams): Promise<CallApiResult> {
  // 查询超时只暂停前端等待，绝不重新提交绘图请求。
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    const result = await mazalRequest<{ items: MazalTask[]; missing_ids: string[] }>(`/api/image-tasks?ids=${encodeURIComponent(id)}`)
    const task = result.items.find((item) => item.id === id)
    if (!task) throw new Error('任务已过期或不存在，请检查历史记录；如需重新生成，请手动提交。')
    mazalTaskStates.set(id, task.status)
    mazalTaskEvents.dispatchEvent(new Event('change'))
    if (task.status === 'error') {
      window.dispatchEvent(new Event('mazal-balance-refresh'))
      throw new Error(task.error || '生成失败，请稍后重试')
    }
    if (task.status === 'success') {
      window.dispatchEvent(new Event('mazal-balance-refresh'))
      const images = await Promise.all((task.data ?? []).map(async (item) => {
        if (item.b64_json) return normalizeBase64Image(item.b64_json, 'image/png')
        if (item.url) return fetchImageUrlAsDataUrl(item.url, 'image/png')
        throw new Error('图片结果不完整')
      }))
      if (!images.length) throw new Error('上游没有返回图片')
      return { images, rawImageUrls: task.data?.map((item) => item.url ?? ''), revisedPrompts: task.data?.map((item) => item.revised_prompt) }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error('连接等待超时，任务可能仍在处理；稍后将继续查询结果。')
}

export async function callMazalImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  if (opts.params.n !== 1) throw new Error('每个任务生成一张图片，多张创作请使用批量排队。')
  const id = opts.clientTaskId ?? crypto.randomUUID()
  // 在发出请求前记录 ID；即使提交响应丢失，刷新后也能查询同一任务。
  await opts.onCustomTaskEnqueued?.({ taskId: id })
  const fields = { client_task_id: id, prompt: opts.prompt, model: 'gpt-image-2', size: opts.params.size, quality: opts.params.quality }
  let init: RequestInit
  const editing = opts.inputImageDataUrls.length > 0
  if (editing) {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields)) form.append(name, value)
    let bytes = 0
    for (const [index, source] of opts.inputImageDataUrls.entries()) {
      const blob = await dataUrlToBlob(source)
      bytes += blob.size
      form.append('image', blob, `reference-${index}.png`)
    }
    if (opts.maskDataUrl) {
      const blob = await dataUrlToBlob(opts.maskDataUrl)
      bytes += blob.size
      form.append('mask', blob, 'mask.png')
    }
    if (bytes > 24 * 1024 ** 2) throw new Error('参考图和遮罩合计不能超过 24 MB，请缩小图片后重试。')
    init = { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) }
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }
  }
  await mazalRequest(`/api/image-tasks/${editing ? 'edits' : 'generations'}`, init)
  return pollMazalTask(id, opts.params)
}
