import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mazalRequest } from '../lib/mazalSession'
import { canAdoptOptimizedPrompt } from '../lib/templateLibrary'
import StudioToolDialog from './StudioToolDialog'

export default function PromptOptimizer() {
  const [open, setOpen] = useState(false)
  return <div className="studio-prompt-tools"><button onClick={() => useStore.getState().setStudioView('templates')}>▦ 灵感模板</button><button onClick={() => setOpen(true)}>✦ 优化提示词</button>{open && <OptimizerDialog close={() => setOpen(false)} />}</div>
}

function OptimizerDialog({ close }: { close: () => void }) {
  const snapshot = useRef({ id: useStore.getState().activeStudioConversationId, prompt: useStore.getState().prompt, references: useStore.getState().inputImages.map((image) => image.id), mask: JSON.stringify(useStore.getState().maskDraft), editing: Boolean(useStore.getState().maskDraft) }).current
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'models' | 'optimize' | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [mode, setMode] = useState(snapshot.editing ? 'edit' : 'create')
  const active = useRef(true)
  const locked = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (operation !== 'optimize') return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [operation])
  const dismiss = () => {
    if (locked.current) { setError('请求正在处理中，请等待完成后再关闭，避免丢失结果。'); return }
    if (result && !window.confirm('优化结果尚未采用，关闭将丢弃结果，继续？')) return
    close()
  }
  const headers: Record<string, string> = key.trim() ? { 'X-Prompt-API-Key': key.trim() } : {}
  const load = async () => {
    if (locked.current) return
    locked.current = true
    setBusy(true); setOperation('models'); setError(''); setModels([]); setLoaded(false)
    try {
      const value = await mazalRequest<{ models: string[]; default_model: string }>('/api/workbench/prompt-optimizer', { headers })
      if (!active.current) return
      setModels(value.models); setModel(value.default_model); setLoaded(true); setError('')
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : '读取模型失败') }
    finally { locked.current = false; if (active.current) { setBusy(false); setOperation(null) } }
  }
  useEffect(() => { void load() }, []) // 密钥仅在本弹窗内存中保留，手动重载权限。
  const optimize = async () => {
    if (locked.current || !loaded || !model || !snapshot.prompt.trim() || snapshot.prompt.length > 6000) return
    locked.current = true
    setBusy(true); setOperation('optimize'); setError('')
    try {
      const value = await mazalRequest<{ prompt: string }>('/api/workbench/prompt-optimizer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: snapshot.prompt, model, mode, has_reference: snapshot.references.length > 0 }), signal: AbortSignal.timeout(100_000) })
      if (active.current) { setResult(value.prompt); setError('') }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : '优化失败') }
    finally { locked.current = false; if (active.current) { setBusy(false); setOperation(null) } }
  }
  const adopt = () => {
    const state = useStore.getState()
    if (locked.current) return
    if (snapshot.mask !== JSON.stringify(state.maskDraft) || !canAdoptOptimizedPrompt(snapshot.id, state.activeStudioConversationId, snapshot.prompt, state.prompt, snapshot.references, state.inputImages.map((image) => image.id))) { setError('对话、原文、参考图或修改区域已改变。请关闭弹窗，从当前草稿重新优化。'); return }
    state.patchStudioDraft(snapshot.id!, { prompt: result })
    state.showToast('已采用优化提示词，可检查后再生成', 'success')
    close()
  }
  return <StudioToolDialog title="优化提示词" close={dismiss}>
    <div className="studio-optimizer-form" aria-busy={busy}><p className="studio-tool-note">补充构图、光线与细节，保留你的主体和约束。只发送文字和是否使用参考图，不上传参考图给文本模型。</p>
      <label>当前提示词<pre className="studio-optimizer-original">{snapshot.prompt || '请先在输入框写下你的想法，再打开优化。'}</pre></label>
      <details><summary>文本模型密钥（可选）</summary><p className="studio-tool-note">默认使用当前登录密钥。若绘图分组未开放文本模型，可填入你自己的主站文本密钥；关闭弹窗即清除。更换密钥后请重新读取模型。</p><input aria-label="文本模型密钥" type="password" autoComplete="off" disabled={busy} value={key} onChange={(event) => { setKey(event.target.value); setLoaded(false); setModels([]); setModel('') }} /><button disabled={busy} className="studio-tool-secondary" onClick={() => void load()}>读取可用模型</button></details>
      {loaded && !models.length && <p className="studio-tool-error">当前密钥没有可用文本模型，请使用已开放文本模型的主站密钥。</p>}
      {models.length > 0 && <label>文本模型<select value={model} disabled={busy || !loaded} onChange={(event) => setModel(event.target.value)}>{models.map((name) => <option key={name}>{name}</option>)}</select></label>}
      <label>优化方向<select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}><option value="create">创作补充 · 构图与风格</option><option value="edit">图片修改 · 限定修改范围</option></select></label>
      <p className="studio-tool-billing">文本优化按所选密钥的主站文本模型规则计费。点击优化即发起文本请求；不会自动生图。</p>
      {error && <p className="studio-tool-error" role="alert">{error}</p>}
      {error && !loaded && !busy && <button className="studio-tool-secondary" onClick={() => void load()}>重新读取模型</button>}
      <button className="studio-tool-primary" disabled={busy || !loaded || !model || !snapshot.prompt.trim() || snapshot.prompt.length > 6000} onClick={() => void optimize()}>{busy ? operation === 'models' ? '正在读取模型…' : '正在优化，请稍候…' : result ? '重新优化（再次计费）' : '优化并预览'}</button>
      {snapshot.prompt.length > 6000 && <p className="studio-tool-error">请将原提示词缩短到 6000 字以内。</p>}
      {operation === 'optimize' && <p className="studio-tool-note" role="status">通常需要数十秒，请保持窗口打开。失败后原有预览仍会保留；不会自动重试收费请求。</p>}
      {result && <div className="studio-optimizer-result"><label>最近一次成功结果 · 可编辑<textarea value={result} disabled={busy} maxLength={6000} rows={8} onChange={(event) => setResult(event.target.value)} /></label><button className="studio-tool-primary" disabled={busy || !result.trim()} onClick={adopt}>采用到当前草稿</button></div>}
    </div>
  </StudioToolDialog>
}
