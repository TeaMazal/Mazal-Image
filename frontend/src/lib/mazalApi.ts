import type { TaskParams } from '../types'
import { dataUrlToBlob } from './canvasImage'
import { fetchImageUrlAsDataUrl, normalizeBase64Image, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { MazalRequestError, mazalRequest } from './mazalSession'

export interface MazalTask {
  id: string
  status: 'queued' | 'running' | 'success' | 'error'
  error?: string
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
}

export const mazalTaskEvents = new EventTarget()
export type MazalTaskPhase = MazalTask['status'] | 'connecting' | 'fetching' | 'recovering'
export const mazalTaskStates = new Map<string, MazalTaskPhase>()

function setPhase(id: string, phase: MazalTaskPhase) {
  mazalTaskStates.set(id, phase)
  mazalTaskEvents.dispatchEvent(new Event('change'))
}

export class MazalTaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MazalTaskError'
  }
}

function connectionInterrupted(error: unknown): boolean {
  if (error instanceof MazalTaskError) return false
  if (error instanceof MazalRequestError) return [408, 429, 500, 502, 503, 504].includes(error.status)
  return error instanceof TypeError || error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name) || /network|fetch|timeout|连接超时/i.test(error instanceof Error ? error.message : '')
}

export async function pollMazalTask(id: string, _params?: TaskParams, submissionUncertain = false): Promise<CallApiResult> {
  // 查询超时只暂停前端等待，绝不重新提交绘图请求。
  const deadline = Date.now() + 30 * 60_000
  const missingGrace = submissionUncertain ? Date.now() + 45_000 : 0
  let failures = 0
  while (Date.now() < deadline) {
    try {
      const result = await mazalRequest<{ items: MazalTask[]; missing_ids: string[] }>(`/api/image-tasks?ids=${encodeURIComponent(id)}`)
      const task = result.items.find((item) => item.id === id)
      if (!task) {
        if (Date.now() >= missingGrace) throw new MazalTaskError('任务已过期或不存在，请检查历史记录和主站用量；如需重新生成，请手动提交。')
        setPhase(id, 'recovering')
      } else {
        if (task.status === 'error') {
          setPhase(id, 'error')
          window.dispatchEvent(new Event('mazal-balance-refresh'))
          throw new MazalTaskError(task.error || '生成失败，请稍后重试')
        }
        if (task.status === 'success') {
          setPhase(id, 'fetching')
          const images = await Promise.all((task.data ?? []).map(async (item) => {
            if (item.b64_json) return normalizeBase64Image(item.b64_json, 'image/png')
            if (item.url) return fetchImageUrlAsDataUrl(item.url, 'image/png')
            throw new MazalTaskError('图片结果不完整，请检查原任务和主站用量后联系管理员。')
          }))
          if (!images.length) throw new MazalTaskError('上游没有返回图片')
          setPhase(id, 'success')
          window.dispatchEvent(new Event('mazal-balance-refresh'))
          return { images, rawImageUrls: task.data?.map((item) => item.url ?? ''), revisedPrompts: task.data?.map((item) => item.revised_prompt) }
        }
        setPhase(id, task.status)
      }
      failures = 0
    } catch (error) {
      if (!connectionInterrupted(error)) throw error
      failures += 1
      setPhase(id, 'recovering')
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 3000 * Math.max(1, failures))))
  }
  throw new Error('连接等待超时，任务可能仍在处理；稍后将继续查询结果。')
}

export async function callMazalImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  if (opts.params.n !== 1) throw new Error('每个任务生成一张图片，多张创作请使用批量排队。')
  const id = opts.clientTaskId ?? crypto.randomUUID()
  // 在发出请求前记录 ID；即使提交响应丢失，刷新后也能查询同一任务。
  await opts.onCustomTaskEnqueued?.({ taskId: id })
  setPhase(id, 'connecting')
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
  try {
    await mazalRequest(`/api/image-tasks/${editing ? 'edits' : 'generations'}`, init)
  } catch (error) {
    if (!connectionInterrupted(error)) throw error
    // 提交响应丢失时只查询已保存的 ID，禁止自动重复 POST。
    setPhase(id, 'recovering')
    return pollMazalTask(id, opts.params, true)
  }
  return pollMazalTask(id, opts.params)
}
