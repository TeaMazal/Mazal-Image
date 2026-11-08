// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../lib/mazalSession', () => ({ getMazalKey: () => 'isolated-test-key', mazalRequest: mock.request }))
vi.mock('./StudioHelp', () => ({ default: () => null }))
vi.mock('../lib/siteConfig', () => ({ siteConfig: { mainOrigin: 'https://example.invalid' } }))
import StudioPriceEstimate from './StudioPriceEstimate'
let root: Root, el: HTMLDivElement
const balance = { balance: 100, remaining: 100, quota: null, rate_limits: [] }
const price = (model: string, value: number) => ({ model, currency: 'USD', unit: 'image', prices: { '1K': value, '2K': value, '4K': value } })
beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
afterEach(() => { act(() => root.unmount()); el.remove() })
describe('model-specific price display', () => {
  it('does not let an earlier model response replace the current model quote', async () => {
    let resolveOld!: (value: unknown) => void
    const old = new Promise(resolve => { resolveOld = resolve })
    mock.request.mockImplementation((url: string) => url.includes('customer-balance') ? Promise.resolve(balance) : url.includes('2.6-sunburst') ? Promise.resolve(price('gpt-image-2.6-sunburst', .07)) : old)
    await act(async () => root.render(<StudioPriceEstimate model="gpt-image-2.5-flare" size="1024x1024" count={1} />))
    await act(async () => root.render(<StudioPriceEstimate model="gpt-image-2.6-sunburst" size="1024x1024" count={1} />))
    expect(el.textContent).toContain('$0.07')
    await act(async () => resolveOld(price('gpt-image-2.5-flare', .99)))
    expect(el.textContent).toContain('$0.07'); expect(el.textContent).not.toContain('$0.99')
  })
  it('shows usage billing without inventing an image price', async () => {
    mock.request.mockImplementation((url: string) => Promise.resolve(url.includes('customer-balance') ? balance : { model: 'gpt-image-2.6', currency: 'USD', unit: 'token' }))
    await act(async () => root.render(<StudioPriceEstimate model="gpt-image-2.6" size="1024x1024" count={2} />))
    expect(el.textContent).toContain('按实际用量计费'); expect(el.textContent).not.toContain('预计 $')
  })
})
