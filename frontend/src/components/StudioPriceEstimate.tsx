import { useEffect, useRef, useState } from 'react'
import { getMazalKey, mazalRequest, type MazalBalance } from '../lib/mazalSession'
import { formatStudioUsd, getStudioAvailableBalance, getStudioPriceEstimate, type StudioImagePricing } from '../lib/studioPricing'
import StudioHelpButton from './StudioHelp'
import { siteConfig } from '../lib/siteConfig'

type PriceData = { pricing: StudioImagePricing; balance: MazalBalance }
let cached: { key: string; data: PriceData; at: number } | null = null

export default function StudioPriceEstimate({ size, count }: { size: string; count: number }) {
  const key = getMazalKey()
  const [data, setData] = useState<PriceData | null>(() => cached?.key === key ? cached.data : null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  async function refresh(signal?: AbortSignal, force = false) {
    if (document.visibilityState === 'hidden') return
    if (!force && cached?.key === key && Date.now() - cached.at < 60_000) {
      setData(cached.data)
      return
    }
    setBusy(true)
    try {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)
      const [pricing, balance] = await Promise.all([
        mazalRequest<StudioImagePricing>('/v1/sub2api/image-pricing', { signal: requestSignal }),
        mazalRequest<MazalBalance>('/api/customer-balance', { signal: requestSignal }),
      ])
      getStudioPriceEstimate(pricing, 'auto', 1)
      if (signal?.aborted) return
      cached = { key, data: { pricing, balance }, at: Date.now() }
      setData(cached.data)
      setError('')
    } catch {
      if (signal?.aborted) return
      if (cached?.key === key) cached = null
      setData(null)
      setError('暂时无法查询价格')
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    const update = () => void refresh(controller.signal)
    const updateNow = () => void refresh(controller.signal, true)
    update()
    const timer = window.setInterval(update, 60_000)
    window.addEventListener('focus', updateNow)
    window.addEventListener('mazal-balance-refresh', updateNow)
    const closeOutside = (event: PointerEvent) => { if (details.current && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && details.current?.open) { details.current.open = false; details.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', updateNow); window.removeEventListener('mazal-balance-refresh', updateNow); document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [])
  const estimate = data && count > 0 ? getStudioPriceEstimate(data.pricing, size, count) : null
  const available = data ? getStudioAvailableBalance(data.balance) : null
  const range = (min: number, max: number) => min === max ? formatStudioUsd(min) : `${formatStudioUsd(min)}–${formatStudioUsd(max)}`
  return <div className="studio-price-estimate" aria-label="本轮费用估算">
    <details ref={details}>
      <summary>{estimate ? `预计 ${range(estimate.totalMin, estimate.totalMax)}` : error ? '价格暂不可用' : count <= 0 ? '费用说明' : '查询价格…'} <span aria-hidden="true">ⓘ</span></summary>
      <div className="studio-price-popover">
        {estimate ? <><p>{range(estimate.unitMin, estimate.unitMax)} / 张 · 本轮 {count} 张 · USD</p><p>{estimate.tier ? `按所选尺寸 ${estimate.tier} 估算；` : '自动尺寸按各档价格估算；'}最终按实际输出尺寸及成功图片数量计费。</p></> : <p>{error || (count <= 0 ? '输入提示词后可查看本轮预计费用。' : '正在读取当前密钥的价格。')}</p>}
        {error && <button disabled={busy} onClick={() => void refresh(undefined, true)}>{busy ? '查询中…' : '重试查询'}</button>}
        <StudioHelpButton topic="billing">查看计费说明 ↗</StudioHelpButton>
      </div>
    </details>
    {estimate && available != null && available + 1e-9 < estimate.totalMax && <a className="studio-price-warning" href={siteConfig.mainOrigin} target="_blank" rel="noreferrer" title={`可用额度约 ${formatStudioUsd(available)}，可能不足以完成本轮`}>额度可能不足 ↗</a>}
  </div>
}
