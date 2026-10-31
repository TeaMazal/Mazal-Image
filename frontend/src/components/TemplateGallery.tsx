import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mazalRequest } from '../lib/mazalSession'
import { fillTemplate, parseTemplateLibrary, type InspirationTemplate } from '../lib/templateLibrary'
import StudioToolDialog from './StudioToolDialog'

function TemplateCover({ item, lazy = false }: { item: InspirationTemplate; lazy?: boolean }) {
  const [failed, setFailed] = useState(false)
  return item.cover && !failed ? <img src={item.cover} alt={`${item.title}风格示例`} loading={lazy ? 'lazy' : 'eager'} decoding="async" onError={() => setFailed(true)} /> : <div className="studio-template-cover-empty" aria-label="暂无预览">✦</div>
}

function TemplateDetail({ item, close }: { item: InspirationTemplate; close: () => void }) {
  const [values, setValues] = useState(Object.fromEntries(item.fields.map((field) => [field.key, field.default])))
  const [destination, setDestination] = useState('new')
  const [error, setError] = useState('')
  const [replace, setReplace] = useState<string | null>(null)
  const applied = useRef(false)
  const currentId = useStore((state) => state.activeStudioConversationId)
  const currentPrompt = useStore((state) => state.prompt)
  const currentMask = useStore((state) => state.maskDraft)
  const dismiss = () => {
    if (item.fields.some((field) => values[field.key] !== field.default) && !window.confirm('填写内容尚未带入草稿，关闭将丢弃这些填写，继续？')) return
    close()
  }
  const preview = item.prompt.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key: string) => values[key]?.trim() || `【${item.fields.find((field) => field.key === key)?.label || key}】`)
  const apply = () => {
    try {
      if (applied.current) return
      const prompt = fillTemplate(item, values)
      const state = useStore.getState()
      const confirmation = JSON.stringify([state.activeStudioConversationId, state.prompt, state.maskDraft, state.inputImages.map((image) => image.id), prompt])
      if (destination === 'current' && (state.prompt.trim() || state.maskDraft) && replace !== confirmation) { setReplace(confirmation); return }
      applied.current = true
      const id = destination === 'new' || !state.activeStudioConversationId ? state.createStudioConversation() : state.activeStudioConversationId
      state.patchStudioDraft(id, destination === 'new' ? { prompt, params: { ...useStore.getState().params, size: item.size } } : { prompt })
      state.setStudioView('create')
      state.showToast(item.reference_required ? '模板已带入，请添加主体参考图后再生成' : '模板已带入，可修改提示词后再生成', 'success')
      close()
    } catch (err) { applied.current = false; setError(err instanceof Error ? err.message : '无法应用模板') }
  }
  return <StudioToolDialog title={item.title} close={dismiss} wide>
    <div className="studio-template-detail">
      <aside><TemplateCover item={item} /><p className="studio-tool-note">{item.preview_note || '风格示意，实际效果以生成结果为准。'}</p><div className="studio-template-source"><p>{item.source_name || '本站模板'}</p><p>{item.license}</p>{item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer">查看原案例 ↗</a>}{item.license.includes('CC BY') && <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0 许可 ↗</a>}</div></aside>
      <div className="studio-template-form"><p className="studio-tool-note">{item.description}</p><span className="studio-template-badge">{item.reference_required ? '需要主体参考图 · 在创作空间上传' : '无需参考图 · 可直接描述'}</span>
        {item.fields.map((field) => <label key={field.key}><span>{field.label}{field.required && <span className="studio-tool-note"> · 必填</span>}</span><input value={values[field.key]} required={field.required} maxLength={500} placeholder={field.placeholder} onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); setError(''); setReplace(null) }} /></label>)}
        <details className="studio-template-prompt"><summary>查看完整提示词</summary><pre>{preview}</pre></details>
        <label>应用到<select value={destination} onChange={(event) => { setDestination(event.target.value); setReplace(null) }}><option value="new">新建独立对话（保留当前草稿）</option>{currentId && <option value="current">当前对话（保留参考图与历史）</option>}</select></label>
        {destination === 'current' && <p className="studio-tool-note">沿用当前尺寸和生成参数。{currentMask ? '当前存在局部修改区域，带入后仍按该区域修改；若要全新创作，请选择新建独立对话。' : '仅替换提示词，参考图与历史作品保留。'}</p>}
        {replace && <p role="alert" className="studio-tool-error">当前草稿已有文字，再次点击将替换提示词。原文：{currentPrompt.slice(0, 100)}{currentPrompt.length > 100 ? '…' : ''}</p>}
        {error && <p role="alert" className="studio-tool-error">{error}</p>}
        <div className="studio-template-actions"><button className="studio-tool-primary" onClick={apply}>{replace ? '确认替换当前提示词' : '带入创作空间'} ↗</button><p className="studio-tool-note">只填写草稿，不会自动生图或扣除生图费用。{item.reference_required ? '带入后需在创作空间上传主体参考图。' : '尺寸可在创作空间继续调整。'}</p></div>
      </div>
    </div>
  </StudioToolDialog>
}

export default function TemplateGallery() {
  const [items, setItems] = useState<InspirationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<InspirationTemplate | null>(null)
  const [limit, setLimit] = useState(24)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void mazalRequest<unknown>('/api/workbench/templates', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) }).then((value) => setItems(parseTemplateLibrary(value))).catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '模板加载失败') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])
  const filtered = items.filter((item) => (category === '全部' || item.category === category) && `${item.title} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()))
  return <section className="studio-template-library">
    <div className="studio-template-intro"><div><p className="studio-eyebrow">给想法一个起点</p><h1>灵感模板</h1><p>从商品大片到日常创作，选一种风格，写下你的主角。</p></div><span>INSPIRATION<br />TO CREATION ↗</span></div>
    <div className="studio-template-filter"><div role="group" aria-label="模板分类">{['全部', ...new Set(items.map((item) => item.category))].map((name) => <button data-active={category === name} key={name} onClick={() => { setCategory(name); setLimit(24) }}>{name}</button>)}</div><input type="search" aria-label="搜索模板" placeholder="搜索风格、用途…" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(24) }} /></div>
    {!loading && !error && <p className="studio-template-count" role="status">{filtered.length} 个模板{category !== '全部' ? ` · ${category}` : ''}{query.trim() ? ` · “${query.trim()}”` : ''}</p>}
    {loading ? <p className="studio-template-status" role="status">正在收集灵感…</p> : error ? <div className="studio-template-status" role="alert"><p>{error}</p><button onClick={() => setRetry(retry + 1)}>重新加载</button></div> : !filtered.length ? <div className="studio-template-status"><p>暂时没有匹配的模板，试试其他关键词。</p><button onClick={() => { setQuery(''); setCategory('全部') }}>清空筛选</button></div> : <div className="studio-template-grid">{filtered.slice(0, limit).map((item) => <button className="studio-template-card" key={item.id} onClick={() => setSelected(item)}><div className="studio-template-cover"><TemplateCover item={item} lazy /><span className="studio-template-use">查看模板 ↗</span></div><div className="studio-template-card-text"><span>{item.category} · {item.reference_required ? '需参考图' : '文字创作'}</span><h2>{item.title}</h2><p>{item.description}</p></div></button>)}</div>}
    {filtered.length > limit && <button className="studio-template-more" onClick={() => setLimit(limit + 24)}>查看更多模板</button>}
    <p className="studio-template-footer">先选模板，再到对话中创作。示例为开源风格参考，作者与许可见模板详情。</p>
    {selected && <TemplateDetail key={selected.id} item={selected} close={() => setSelected(null)} />}
  </section>
}
