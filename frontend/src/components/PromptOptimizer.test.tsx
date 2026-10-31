// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PromptOptimizer from './PromptOptimizer'

const data = vi.hoisted(() => ({
  request: vi.fn(),
  state: { activeStudioConversationId: 'a', prompt: '一只猫', inputImages: [] as { id: string }[], maskDraft: null as unknown, patchStudioDraft: vi.fn(), showToast: vi.fn() },
}))
vi.mock('../store', () => ({ useStore: { getState: () => data.state } }))
vi.mock('../lib/mazalSession', () => ({ mazalRequest: data.request }))
vi.mock('./StudioToolDialog', () => ({ default: ({ close, children }: { close: () => void; children: React.ReactNode }) => <section role="dialog"><button onClick={close}>关闭</button>{children}</section> }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let cleanup = () => {}
afterEach(() => { cleanup(); data.request.mockReset(); data.state.patchStudioDraft.mockReset(); data.state.maskDraft = null; vi.restoreAllMocks() })

async function open() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanup = () => { act(() => root.unmount()); container.remove() }
  act(() => root.render(<PromptOptimizer />))
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('优化提示词'))!.click() })
  return container
}

describe('提示词优化请求和草稿保护', () => {
  it('模型读取期间锁定密钥，双击只发送一次优化，失败后保留已有结果', async () => {
    let models!: (value: unknown) => void
    data.request.mockReturnValueOnce(new Promise((resolve) => { models = resolve }))
    const container = await open()
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.disabled).toBe(true)
    await act(async () => models({ models: ['gpt-test'], default_model: 'gpt-test' }))
    let complete!: (value: unknown) => void
    data.request.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === '优化并预览')!
    act(() => { button.click(); button.click() })
    expect(data.request).toHaveBeenCalledTimes(2)
    act(() => [...container.querySelectorAll('button')].find((item) => item.textContent === '关闭')!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => complete({ prompt: '成功预览' }))
    data.request.mockRejectedValueOnce(new Error('网络错误'))
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('重新优化'))!.click())
    expect(container.querySelector('textarea')!.value).toBe('成功预览')
    expect(container.textContent).toContain('网络错误')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    act(() => [...container.querySelectorAll('button')].find((item) => item.textContent === '关闭')!.click())
    expect(confirm).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('优化期间修改区域改变时，不覆盖当前草稿', async () => {
    data.request.mockResolvedValueOnce({ models: ['gpt-test'], default_model: 'gpt-test' }).mockResolvedValueOnce({ prompt: '新提示词' })
    const container = await open()
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === '优化并预览')!.click())
    data.state.maskDraft = { imageId: 'changed' }
    act(() => [...container.querySelectorAll('button')].find((item) => item.textContent === '采用到当前草稿')!.click())
    expect(data.state.patchStudioDraft).not.toHaveBeenCalled()
    expect(container.textContent).toContain('修改区域已改变')
  })
})
