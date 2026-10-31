import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ImageWorkbench from '../ImageWorkbench.vue'
import Select from '../common/Select.vue'

const { list, post } = vi.hoisted(() => ({ list: vi.fn(), post: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 7 } }) }))
vi.mock('@/api/keys', () => ({ list }))
vi.mock('@/api/groups', () => ({ getUserGroupRates: async () => ({}) }))
vi.mock('@/api/client', () => ({ apiClient: { post } }))
const eligible = { id: 12, name: '绘图密钥', key: 'must-not-enter-url', status: 'active', quota: 0, quota_used: 0, group: { name: '图片分组', status: 'active', allow_image_generation: true, rate_multiplier: 1 } }
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  localStorage.clear()
  list.mockReset().mockResolvedValue({ items: [eligible, { ...eligible, id: 13, group: { ...eligible.group, allow_image_generation: false } }], pages: 1 })
  post.mockReset().mockResolvedValue({ data: { ticket: 'single-use-ticket' } })
})
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('AI 绘图主站入口', () => {
  it('刷新恢复分组后等待用户进入，每次挂载使用不同框架名称', async () => {
    localStorage.setItem('mazal-drawing-key-7', '12')
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('继续你的图片创作')
    await wrapper.findAll('button').find((button) => button.text() === '进入创作空间')!.trigger('click')
    const first = wrapper.get('iframe').element as HTMLIFrameElement
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(first.isConnected).toBe(true)
    expect(new URL(first.src).searchParams.get('embed')).toBe('mazal')
    expect(first.name).toMatch(/^mazal-image-/)
    const firstName = first.name
    wrapper.unmount()
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    await wrapper.findAll('button').find((button) => button.text() === '进入创作空间')!.trigger('click')
    expect((wrapper.get('iframe').element as HTMLIFrameElement).name).not.toBe(firstName)
  })

  it('重复握手不会签发多张一次性票据', async () => {
    localStorage.setItem('mazal-drawing-key-7', '12')
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '进入创作空间')!.trigger('click')
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const event = { origin: 'https://image.mazal.lol', source: frame.contentWindow, data: { type: 'mazal-image-ready', nonce: 'ready_nonce_123456789012345678' } }
    window.dispatchEvent(new MessageEvent('message', event))
    window.dispatchEvent(new MessageEvent('message', event))
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('没有握手时只自动重连一次，收到握手后不打断登录', async () => {
    vi.useFakeTimers()
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    wrapper.getComponent(Select).vm.$emit('update:modelValue', '12')
    await flushPromises()
    const first = wrapper.get('iframe').element
    await vi.advanceTimersByTimeAsync(8_000)
    const second = wrapper.get('iframe').element as HTMLIFrameElement
    expect(second).toBe(first)
    expect(second.src).toContain('-retry')
    await vi.advanceTimersByTimeAsync(8_000)
    expect(wrapper.get('iframe').element).toBe(second)
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://image.mazal.lol', source: second.contentWindow, data: { type: 'mazal-image-ready', nonce: 'ready_nonce_123456789012345678' } }))
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(wrapper.get('iframe').element).toBe(second)
  })
  it('只提供可绘图密钥，未选择前不加载绘图框架', async () => {
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    expect(wrapper.getComponent(Select).props('options')).toHaveLength(2)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('校验消息来源，只传一次性票据，网址及偏好不含密钥', async () => {
    wrapper = mount(ImageWorkbench, { attachTo: document.body, global: { stubs: { RouterLink: true, Select: true } } })
    await flushPromises()
    wrapper.getComponent(Select).vm.$emit('update:modelValue', '12')
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(frame.src).toBe('https://image.mazal.lol/embed?embed=mazal')
    expect(localStorage.getItem('mazal-drawing-key-7')).toBe('12')
    const source = frame.contentWindow!
    const send = vi.spyOn(source, 'postMessage')
    const data = { type: 'mazal-image-ready', nonce: 'valid_nonce_123456789012345678' }
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.invalid', source, data }))
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://image.mazal.lol', source, data }))
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/image-workbench/ticket', { key_id: 12, nonce: data.nonce })
    expect(send).toHaveBeenCalledWith({ type: 'mazal-image-ticket', nonce: data.nonce, ticket: 'single-use-ticket' }, 'https://image.mazal.lol')
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://image.mazal.lol', source, data: { type: 'mazal-image-connected' } }))
    await flushPromises()
    await wrapper.get('button[aria-label="绘图设置"]').trigger('click')
    expect(send).toHaveBeenCalledWith({ type: 'mazal-image-open-settings' }, 'https://image.mazal.lol')
  })
})
