import { useEffect, useState, type ComponentType } from 'react'
import { getMazalKey, isMazalEmbedded, mazalRequest, saveMazalSession, type MazalSession } from '../lib/mazalSession'
import { siteConfig } from '../lib/siteConfig'
import StudioHelpButton from './StudioHelp'

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
  if (isMazalEmbedded) return <main className="studio-entry studio-entry-embedded"><p role={error ? 'alert' : 'status'}>{error || '正在连接主站账户…'}</p></main>

  return (
    <main className="studio-entry">
      <section className="studio-entry-card" aria-labelledby="studio-entry-title">
        <div className="studio-entry-brand"><span className="studio-entry-logo" aria-hidden="true">{siteConfig.name.slice(0, 1)}</span><span>{siteConfig.name}</span></div>
        <p className="studio-entry-eyebrow">你的图片创作空间</p>
        <h1 id="studio-entry-title">让想法成为画面</h1>
        <p className="studio-entry-intro">从一个灵感开始，在每一轮创作中继续完善。</p>
        <form onSubmit={(event) => { event.preventDefault(); void login(key, remember) }}>
          <label htmlFor="mazal-key">主站 API 密钥</label>
          <input id="mazal-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="请输入主站签发的密钥" disabled={busy} aria-describedby="studio-entry-key-hint" />
          <p id="studio-entry-key-hint" className="studio-entry-key-hint">使用主站绘图分组的密钥登录。</p>
          <label className="studio-entry-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />在这台设备上记住密钥（公共设备请勿勾选）</label>
          {error && <p role="alert" className="studio-entry-error">{error}</p>}
          <button type="submit" disabled={busy} className="studio-entry-submit">{busy ? '正在连接…' : '进入创作空间'}{!busy && <span aria-hidden="true">↗</span>}</button>
        </form>
        <div className="studio-entry-links"><a href={siteConfig.mainOrigin} target="_blank" rel="noreferrer">获取密钥 / 查看账户 ↗</a><StudioHelpButton /></div>
        <p className="studio-entry-local-note">作品保存在当前浏览器，重要图片请及时下载。更换设备或清除浏览器数据后，本地作品不会自动同步。</p>
      </section>
    </main>
  )
}
