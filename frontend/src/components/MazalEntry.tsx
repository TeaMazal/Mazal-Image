import { useEffect, useState, type ComponentType } from 'react'
import { getMazalKey, isMazalEmbedded, mazalRequest, saveMazalSession, type MazalSession } from '../lib/mazalSession'
import { siteConfig } from '../lib/siteConfig'

export default function MazalEntry() {
  const [App, setApp] = useState<ComponentType | null>(null)
  const [key, setKey] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login(value: string, keep: boolean) {
    if (!value.trim()) return setError('请输入主站 API 密钥')
    setBusy(true)
    setError('')
    try {
      const session = await mazalRequest<MazalSession>('/api/workbench/session', {}, value.trim())
      if (session.role === 'admin') {
        setError('此页面仅供主站用户登录，请使用主站 API 密钥。')
        return
      }
      saveMazalSession(value.trim(), session, keep)
      // 工作区只在身份确定后加载，图库和设置按密钥身份隔离。
      const module = await import('../App')
      setApp(() => module.default)
      setKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败，请重试')
      if (isMazalEmbedded) window.parent.postMessage({ type: 'mazal-image-error' }, siteConfig.mainOrigin)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (isMazalEmbedded) {
      const nonce = crypto.randomUUID().replace(/-/g, '')
      let active = true
      let receiving = false
      const onMessage = async (event: MessageEvent) => {
        if (receiving || event.origin !== siteConfig.mainOrigin || event.source !== window.parent || event.data?.type !== 'mazal-image-ticket' || event.data.nonce !== nonce || typeof event.data.ticket !== 'string') return
        receiving = true
        try {
          const result = await mazalRequest<{ key: string }>('/api/workbench/bridge/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: event.data.ticket, nonce }) }, '')
          if (!active) return
          await login(result.key, false)
        } catch {
          if (active) {
            setError('登录交接失效，请在主站点击重新连接。')
            window.parent.postMessage({ type: 'mazal-image-error' }, siteConfig.mainOrigin)
          }
        }
      }
      window.addEventListener('message', onMessage)
      const announce = () => {
        if (active && !receiving) window.parent.postMessage({ type: 'mazal-image-ready', nonce }, siteConfig.mainOrigin)
      }
      announce()
      const retry = window.setInterval(announce, 1500)
      return () => { active = false; window.clearInterval(retry); window.removeEventListener('message', onMessage) }
    }
    const stored = getMazalKey()
    if (stored) void login(stored, Boolean(localStorage.getItem('mazal-image-key')))
  }, [])

  if (App) return <App />
  if (isMazalEmbedded) return <main className="min-h-screen grid place-items-center p-6 text-sm text-gray-500"><p role={error ? 'alert' : 'status'}>{error || '正在连接主站账户…'}</p></main>

  return (
    <main className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-950 dark:to-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 p-7 sm:p-9 shadow-xl shadow-slate-200/40 dark:shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white grid place-items-center text-2xl font-semibold mb-6">M</div>
        <p className="text-xs font-semibold tracking-widest text-blue-600 dark:text-blue-400 mb-2">{siteConfig.name}</p>
        <h1 className="text-3xl font-bold tracking-tight">让想法成为画面</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">用主站密钥登录，开始创作、标注和修改图片。</p>
        <form className="mt-7 space-y-4" onSubmit={(event) => { event.preventDefault(); void login(key, remember) }}>
          <label className="block text-sm font-medium" htmlFor="mazal-key">主站 API 密钥</label>
          <input id="mazal-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="请输入主站签发的密钥" disabled={busy} className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="flex gap-2 items-center text-xs text-gray-500"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />在这台设备上记住密钥（公共设备请勿勾选）</label>
          {error && <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-600 dark:text-red-300 break-words">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 text-sm font-medium">{busy ? '正在连接…' : '进入绘图工作区'}</button>
        </form>
        <div className="mt-5 text-xs text-gray-500"><a className="hover:text-blue-600" href={siteConfig.mainOrigin} target="_blank" rel="noreferrer">获取密钥 / 查看账户</a></div>
        <p className="mt-7 border-t border-gray-100 dark:border-white/10 pt-5 text-xs text-gray-400 leading-5">作品保存在当前浏览器，重要图片请及时下载。更换设备或清除浏览器数据后，本地作品不会自动同步。</p>
      </section>
    </main>
  )
}
