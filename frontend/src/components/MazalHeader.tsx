import StudioNavigation from './StudioNavigation'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getMazalSession, isMazalEmbedded, logoutMazal, mazalRequest, type MazalBalance } from '../lib/mazalSession'
import { siteConfig } from '../lib/siteConfig'
import StudioHelpButton from './StudioHelp'

export default function MazalHeader() {
  const setShowSettings = useStore((state) => state.setShowSettings)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const active = useStore((state) => state.tasks.filter((task) => task.status === 'running' || task.customRecoverable).length)
  const [balance, setBalance] = useState<MazalBalance | null>(getMazalSession()?.balance ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)

  async function refresh() {
    if (document.visibilityState === 'hidden') return
    setBusy(true)
    try {
      setBalance(await mazalRequest<MazalBalance>('/api/customer-balance'))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '余额读取失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    const onRefresh = () => void refresh()
    window.addEventListener('focus', onRefresh)
    window.addEventListener('mazal-balance-refresh', onRefresh)
    document.addEventListener('visibilitychange', onRefresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onRefresh)
      window.removeEventListener('mazal-balance-refresh', onRefresh)
      document.removeEventListener('visibilitychange', onRefresh)
    }
  }, [])

  const amount = balance?.balance ?? balance?.quota?.remaining ?? balance?.remaining
  const label = balance?.balance != null ? '余额' : balance?.quota ? '密钥额度' : balance?.subscription ? '订阅额度' : '可用额度'
  const notice = getMazalSession()?.notice
  useEffect(() => {
    if (!isMazalEmbedded) return
    window.parent.postMessage({ type: 'mazal-image-connected' }, siteConfig.mainOrigin)
    window.parent.postMessage({ type: 'mazal-image-state', active: active > 0 }, siteConfig.mainOrigin)
  }, [active])

  useEffect(() => {
    if (!isMazalEmbedded) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin === siteConfig.mainOrigin && event.source === window.parent && event.data?.type === 'mazal-image-open-settings') setShowSettings(true)
    }
    window.addEventListener('message', onMessage)
    document.documentElement.dataset.mazalEmbedded = 'true'
    return () => {
      window.removeEventListener('message', onMessage)
      delete document.documentElement.dataset.mazalEmbedded
    }
  }, [setShowSettings])

  if (isMazalEmbedded) return <>
    <header className="studio-embedded-header"><StudioNavigation /><StudioHelpButton className="studio-embedded-help" /></header>
    <div style={{ height: 48 }} />
    {notice && <p role="status" className="mx-4 mt-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{notice}</p>}
  </>

  return (
    <>
      <header className="studio-header safe-area-top fixed top-0 inset-x-0 z-40 border-b border-gray-200 dark:border-white/10 backdrop-blur">
        <div className="studio-header-inner safe-area-x mx-auto flex items-center justify-between gap-3 h-16">
          <a href="/" className="flex items-center gap-2.5 shrink-0"><span className="studio-logo w-8 h-8 grid place-items-center text-white rounded-xl font-semibold">{siteConfig.name.slice(0, 1)}</span><span className="font-bold text-base tracking-tight">{siteConfig.name}</span></a>
          <StudioNavigation />
          <div className="studio-account-controls flex items-center gap-2 text-xs min-w-0">
            <div className="relative">
              <button type="button" onClick={() => { setDetails(!details); void refresh() }} title="查看额度详情并刷新" className={`rounded-full px-3 py-2 font-medium ${error ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'studio-balance'}`}>
                {error ? '余额重试' : `${label} ${amount == null ? '待查询' : '$' + amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`}{busy && <span aria-label="正在刷新"> ↻</span>}
              </button>
              {details && <div className="absolute right-0 top-12 w-64 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-xl text-xs leading-6">
                {error && <p className="text-amber-600 break-words">{error}</p>}
                {balance?.balance != null && <p>钱包余额：${balance.balance.toFixed(4)}</p>}
                {balance?.quota?.remaining != null && <p>密钥剩余额度：${balance.quota.remaining.toFixed(4)}</p>}
                {balance?.rate_limits.map((limit) => <p key={limit.window}>{({ '5h': '5 小时', '1d': '每日', '7d': '每周' } as Record<string, string>)[limit.window]}剩余：{limit.remaining == null ? '—' : '$' + limit.remaining.toFixed(4)}</p>)}
                <p className="text-gray-400 mt-1">金额单位 USD，最终费用以主站用量记录为准。</p>
                <p className="text-gray-500">钱包余额、密钥额度和周期限额会共同影响可用额度。</p>
                <StudioHelpButton topic="billing" className="block text-blue-600">图片价格与额度说明 ↗</StudioHelpButton>
                <a className="text-blue-600" href={siteConfig.mainOrigin} target="_blank" rel="noreferrer">查看账户与用量 ↗</a>
                <button className="block text-gray-500 mt-2" onClick={() => setDetails(false)}>收起</button>
              </div>}
            </div>
            <StudioHelpButton className="studio-header-help rounded-lg px-2 py-2 hover:bg-gray-100 dark:hover:bg-white/10"><span className="studio-help-full">使用</span>帮助</StudioHelpButton>
            <button onClick={() => setShowSettings(true)} className="rounded-lg px-2 py-2 hover:bg-gray-100 dark:hover:bg-white/10" aria-label="偏好与数据">设置</button>
            {!isMazalEmbedded && <button className="rounded-lg px-2 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" onClick={() => setConfirmDialog({ title: '退出绘图站', message: active ? '任务已提交到服务器。退出不会取消任务，使用同一密钥登录后可以继续查询。' : '退出后将清除本设备记住的密钥，本地作品会保留。', confirmText: '退出', action: logoutMazal })}>退出</button>}
          </div>
        </div>
      </header>
      <div style={{ height: 'var(--header-height)' }} />
      {notice && <section className="safe-area-x max-w-7xl mx-auto pt-3"><p role="status" className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{notice}</p></section>}
    </>
  )
}
