import type { MazalBalance } from './mazalSession'

export interface StudioImagePricing {
  model: string
  currency: 'USD'
  unit: 'image'
  prices: Record<'1K' | '2K' | '4K', number>
  observed_at: string
  billing_size_source: 'output'
}

export function getStudioPriceEstimate(pricing: StudioImagePricing, size: string, count: number) {
  const tiers = ['1K', '2K', '4K'] as const
  if (pricing.model !== 'gpt-image-2' || pricing.currency !== 'USD' || pricing.unit !== 'image' || !tiers.every((tier) => Number.isFinite(pricing.prices?.[tier]) && pricing.prices[tier] >= 0) || !Number.isSafeInteger(count) || count <= 0) throw new Error('价格数据暂时不可用')
  const dimensions = /^(\d+)x(\d+)$/.exec(size)
  const edge = dimensions ? Math.max(Number(dimensions[1]), Number(dimensions[2])) : 0
  const tier = edge > 0 ? edge <= 1024 ? '1K' : edge <= 2048 ? '2K' : '4K' : null
  const values = tier ? [pricing.prices[tier]] : tiers.map((key) => pricing.prices[key])
  return { tier, unitMin: Math.min(...values), unitMax: Math.max(...values), totalMin: Math.min(...values) * count, totalMax: Math.max(...values) * count }
}

export function getStudioAvailableBalance(balance: MazalBalance) {
  const values = [balance.balance, balance.quota?.remaining, balance.remaining, ...balance.rate_limits.map((limit) => limit.remaining)].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return values.length ? Math.max(0, Math.min(...values)) : null
}

export function formatStudioUsd(value: number) {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}
