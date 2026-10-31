import { describe, expect, it } from 'vitest'
import { getStudioAvailableBalance, getStudioPriceEstimate, type StudioImagePricing } from './studioPricing'

const pricing: StudioImagePricing = { model: 'gpt-image-2', currency: 'USD', unit: 'image', prices: { '1K': .03, '2K': .05, '4K': .1 }, observed_at: '', billing_size_source: 'output' }

describe('用户图片费用估算', () => {
  it('按最长边分档并乘以真实图片数量', () => {
    expect(getStudioPriceEstimate(pricing, '1024x1024', 3)).toMatchObject({ tier: '1K', totalMin: .09, totalMax: .09 })
    expect(getStudioPriceEstimate(pricing, '1536x1024', 2)).toMatchObject({ tier: '2K', totalMax: .1 })
    expect(getStudioPriceEstimate(pricing, '3840x2160', 1)).toMatchObject({ tier: '4K', totalMax: .1 })
  })
  it('自动尺寸显示真实价格区间并支持免费分组', () => {
    expect(getStudioPriceEstimate(pricing, 'auto', 2)).toMatchObject({ tier: null, totalMin: .06, totalMax: .2 })
    expect(getStudioPriceEstimate({ ...pricing, prices: { '1K': 0, '2K': 0, '4K': 0 } }, 'auto', 1).totalMax).toBe(0)
  })
  it('拒绝缺失、负数和非有限报价', () => {
    for (const value of [-1, NaN, Infinity, undefined]) expect(() => getStudioPriceEstimate({ ...pricing, prices: { ...pricing.prices, '2K': value as number } }, 'auto', 1)).toThrow()
  })
  it('同时检查钱包、密钥和周期剩余额度', () => {
    expect(getStudioAvailableBalance({ source: 'sub2api', balance: 100, remaining: null, quota: { limit: 5, used: 4, remaining: 1 }, rate_limits: [{ window: '1d', remaining: .01 }], subscription: false })).toBe(.01)
  })
})
