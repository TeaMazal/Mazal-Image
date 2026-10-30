// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callMazalImageApi, pollMazalTask } from './mazalApi'
import { getMazalKey, mazalStorageName, saveMazalSession } from './mazalSession'
import type { MazalSession } from './mazalSession'

const session: MazalSession = {
  subject_id: 'sub2api-test-a', role: 'user', models: ['gpt-image-2'], notice: '',
  balance: { source: 'sub2api', balance: 12, remaining: 12, quota: null, rate_limits: [], subscription: false },
}
const opts = { settings: DEFAULT_SETTINGS, prompt: '测试画面', params: DEFAULT_PARAMS, inputImageDataUrls: [], clientTaskId: 'stable-attempt-id' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  saveMazalSession('sk-isolated-test', session, false)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Mazal 任务适配', () => {
  it('在提交前保存任务编号，使用客户身份轮询，不重复生成', async () => {
    vi.useFakeTimers()
    let saved = false
    const paths: string[] = []
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      paths.push(path)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-isolated-test')
      if (init?.method === 'POST') {
        expect(saved).toBe(true)
        expect(JSON.parse(String(init.body)).client_task_id).toBe('stable-attempt-id')
        return json({ id: 'stable-attempt-id', status: 'queued' })
      }
      return json({ items: [{ id: 'stable-attempt-id', status: paths.length === 2 ? 'queued' : 'success', data: [{ b64_json: 'cG5n' }] }], missing_ids: [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = callMazalImageApi({ ...opts, onCustomTaskEnqueued: async () => { await Promise.resolve(); saved = true } })
    await vi.runAllTimersAsync()
    expect((await pending).images).toEqual(['data:image/png;base64,cG5n'])
    expect(paths.filter((path) => path.endsWith('/generations'))).toHaveLength(1)
    expect(paths.filter((path) => path.includes('?ids='))).toHaveLength(2)
  })

  it('参考图与遮罩完整送入异步编辑接口', async () => {
    let form: FormData | undefined
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('data:')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
      if (init?.method === 'POST') { form = init.body as FormData; return json({ id: opts.clientTaskId }) }
      return json({ items: [{ id: opts.clientTaskId, status: 'success', data: [{ b64_json: 'cG5n' }] }] })
    }))
    await callMazalImageApi({ ...opts, inputImageDataUrls: ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg=='], maskDataUrl: 'data:image/png;base64,Yw==' })
    expect(form?.getAll('image')).toHaveLength(2)
    expect(form?.getAll('mask')).toHaveLength(1)
    expect(form?.get('client_task_id')).toBe(opts.clientTaskId)
    expect(form?.get('model')).toBe('gpt-image-2')
  })

  it('恢复只查询原任务；额度不足错误不会回退到本地引擎', async () => {
    const fetcher = vi.fn(async () => json({ items: [{ id: 'old-task', status: 'error', error: '余额不足' }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(pollMazalTask('old-task')).rejects.toThrow('余额不足')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toHaveLength(2)
  })

  it('不存在的任务不会重新提交或重扣费用', async () => {
    const fetcher = vi.fn(async () => json({ items: [], missing_ids: ['missing'] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(pollMazalTask('missing')).rejects.toThrow('任务已过期或不存在')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('默认会话保存密钥，用户选择后才长期记住，图库按身份分开', () => {
    expect(getMazalKey()).toBe('sk-isolated-test')
    expect(localStorage.getItem('mazal-image-key')).toBeNull()
    const first = mazalStorageName()
    saveMazalSession('sk-second', { ...session, subject_id: 'sub2api-test-b' }, true)
    expect(mazalStorageName()).not.toBe(first)
    expect(localStorage.getItem('mazal-image-key')).toBe('sk-second')
    saveMazalSession('sk-third', session, false)
    expect(localStorage.getItem('mazal-image-key')).toBeNull()
  })
})
