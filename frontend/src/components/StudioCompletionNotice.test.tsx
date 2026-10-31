// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import StudioCompletionNotice from './StudioCompletionNotice'

const data = vi.hoisted(() => ({ tasks: [] as TaskRecord[], open: vi.fn() }))
vi.mock('../hooks/usePrivacyMode', () => ({ useVisibleTasks: () => data.tasks }))
vi.mock('../store', () => ({ useStore: (select: (state: { studioConversations: Array<{ id: string; title: string }> }) => unknown) => select({ studioConversations: [{ id: 'a', title: '橘猫创作' }] }) }))
vi.mock('../lib/studioActions', () => ({ openStudioTask: data.open }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { data.tasks = []; data.open.mockReset() })

describe('studio completion navigation', () => {
  it('announces only newly finished tasks and opens the exact round', () => {
    const source = { id: 'pending', studioConversationId: 'a', status: 'running', outputImages: [] } as unknown as TaskRecord
    data.tasks = [{ ...source, id: 'old', status: 'done', outputImages: ['old-image'] }, source]
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<StudioCompletionNotice />))
    expect(container.textContent).toBe('')
    const completed = { ...source, status: 'done' as const, outputImages: ['new-image'] }
    data.tasks = [data.tasks[0], completed]
    act(() => root.render(<StudioCompletionNotice />))
    expect(container.textContent).toContain('橘猫创作')
    expect(container.textContent).toContain('1 张图片已就绪')
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('查看结果'))!
    act(() => button.click())
    expect(data.open).toHaveBeenCalledWith(completed)
    expect(container.textContent).toBe('')
    act(() => root.unmount())
  })

  it('waits for recoverable tasks and offers a task link for terminal errors', () => {
    const source = { id: 'recovering', studioConversationId: 'a', status: 'error', customRecoverable: true, outputImages: [] } as unknown as TaskRecord
    data.tasks = [source]
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<StudioCompletionNotice />))
    expect(container.textContent).toBe('')
    data.tasks = [{ ...source, customRecoverable: false }]
    act(() => root.render(<StudioCompletionNotice />))
    expect(container.textContent).toContain('查看任务')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭这条任务通知"]')!.click())
    expect(container.textContent).toBe('')
    act(() => root.unmount())
  })
})
