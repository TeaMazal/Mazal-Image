// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), regenerate: vi.fn(), remove: vi.fn(), download: vi.fn().mockResolvedValue({ failCount: 0 }), detail: vi.fn() }))
vi.mock('../lib/siteConfig', () => ({ downloadPrefix: 'Souhub-Image', siteConfig: { name: 'Souhub Image' } }))
vi.mock('../store', () => ({ useStore: Object.assign((select: (s: unknown) => unknown) => select({ batchProgress: null }), { getState: () => ({ setDetailTaskId: mocks.detail }) }) }))
vi.mock('../hooks/usePrivacyMode', () => ({ useVisibleTasks: () => [] }))
vi.mock('../lib/studioActions', () => ({ prepareStudioTask: mocks.prepare, requestRegenerateStudioTask: mocks.regenerate, requestDeleteStudioTask: mocks.remove }))
vi.mock('../lib/imageCache', () => ({ ensureImageThumbnailCached: async () => ({ src: 'data:image/png;base64,aQ==' }), subscribeImageThumbnail: () => () => {} }))
vi.mock('../lib/downloadImages', () => ({ downloadImageIds: mocks.download, getDownloadErrorMessage: () => '失败' }))
vi.mock('./StudioHelp', () => ({ default: () => null, StudioWelcome: () => null }))
import { StudioTurn } from './StudioThread'

let root: Root
let el: HTMLDivElement
const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({ id, studioConversationId: 'a', studioRoundId: 'r', studioRoundTotal: 2, prompt: '两条龙', params: { ...DEFAULT_PARAMS, n: 1 }, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, ...patch })
beforeEach(() => { el = document.createElement('div'); document.body.append(el); root = createRoot(el); vi.clearAllMocks() })
afterEach(() => { act(() => root.unmount()); el.remove() })

describe('studio round presentation', () => {
  it('shows the first image while the second is running and appends its result to the same turn', async () => {
    const a = task('a', { outputImages: ['one'] })
    const b = task('b', { studioRoundIndex: 1, status: 'running' })
    await act(async () => root.render(<StudioTurn tasks={[a, b]} index={0} />))
    expect(el.querySelectorAll('article')).toHaveLength(1)
    expect(el.querySelectorAll('.studio-turn-request')).toHaveLength(1)
    expect(el.querySelectorAll('.studio-result')).toHaveLength(1)
    expect(el.textContent).toContain('本轮共 2 张，已完成 1 张')
    await act(async () => root.render(<StudioTurn tasks={[a, { ...b, status: 'done', outputImages: ['two'] }]} index={0} />))
    expect(el.querySelectorAll('.studio-result')).toHaveLength(2)
    expect(el.querySelectorAll('[aria-label="本轮操作"]')).toHaveLength(1)
    expect(el.querySelector('#studio-turn-b')).not.toBeNull()
    expect(el.textContent).toContain('2/2 张')
    const download = el.querySelectorAll<HTMLButtonElement>('[aria-label="下载这张图片"]')[1]
    await act(async () => download.click())
    expect(mocks.download).toHaveBeenCalledWith(['two'], 'Souhub-Image')
    expect(el.querySelector('.studio-round-more')?.hasAttribute('open')).toBe(false)
  })
  it('preserves a successful sibling when another image fails', async () => {
    await act(async () => root.render(<StudioTurn tasks={[task('a', { outputImages: ['one'] }), task('b', { status: 'error', error: 'synthetic failure' })]} index={0} />))
    expect(el.querySelectorAll('.studio-result')).toHaveLength(1)
    expect(el.textContent).toContain('部分完成')
    expect(el.textContent).toContain('第 2 张：')
    expect(el.querySelectorAll('[aria-label="本轮操作"]')).toHaveLength(1)
  })
})
