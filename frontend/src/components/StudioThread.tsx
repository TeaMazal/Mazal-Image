import { useEffect, useState, type ReactNode } from 'react'
import type { TaskRecord } from '../types'
import { useStore } from '../store'
import { useVisibleTasks } from '../hooks/usePrivacyMode'
import { getStudioConversationId } from '../lib/studioConversations'
import { prepareStudioTask, requestDeleteStudioTask, requestRegenerateStudioTask } from '../lib/studioActions'
import { getStudioFailureAdvice } from '../lib/studioFeedback'
import { getTaskPromptText } from '../lib/promptImageMentions'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../lib/imageCache'
import { downloadImageIds, getDownloadErrorMessage } from '../lib/downloadImages'
import { useStudioThreadScroll } from '../hooks/useStudioThreadScroll'
import { getStudioRoundTotal, groupStudioRounds, isStudioTaskRunning } from '../lib/studioRounds'
import MazalTaskStatus from './MazalTaskStatus'
import StudioHelpButton, { StudioWelcome } from './StudioHelp'
import { downloadPrefix, siteConfig } from '../lib/siteConfig'

function StudioActionIcon({ name }: { name: 'edit' | 'download' | 'bookmark' | 'chat' | 'retry' | 'settings' | 'more' | 'chevron' | 'arrow' | 'trash' }) {
  const paths = {
    edit: 'm15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15v5Z',
    download: 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',
    bookmark: 'M6 4h12v17l-6-4-6 4V4Z',
    chat: 'M12 4H5a2 2 0 0 0-2 2v14l4-3h11a2 2 0 0 0 2-2v-3m-3-9v6m-3-3h6',
    retry: 'M20 10a8 8 0 1 0-2 8M20 4v6h-6',
    settings: 'M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2M11 3v6M6 9v6m8 0v6',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    chevron: 'm8 10 4 4 4-4',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  }
  return <svg className={`studio-action-icon studio-action-icon-${name}`} aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

function StudioImage({ id, task, reference = false, index, roundActions, anchorId }: { id: string; task: TaskRecord; reference?: boolean; index?: number; roundActions?: ReactNode; anchorId?: string }) {
  const [src, setSrc] = useState('')
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let active = true
    setSrc('')
    setMissing(false)
    const unsubscribe = subscribeImageThumbnail(id, (thumbnail) => { if (active) { setSrc(thumbnail.src); setMissing(false) } })
    void ensureImageThumbnailCached(id).then((thumbnail) => {
      if (!active) return
      if (thumbnail) setSrc(thumbnail.src)
      else setMissing(true)
    }).catch(() => { if (active) setMissing(true) })
    return () => { active = false; unsubscribe() }
  }, [id])
  return <div id={anchorId} className={reference ? 'studio-reference' : 'studio-result'}>
    <button className="studio-result-image" aria-label={reference ? '查看本轮参考图' : `查看生成图片：${getTaskPromptText(task.prompt, task.inputImageIds.length)}`} onClick={() => useStore.getState().setLightboxImageId(id, reference ? task.inputImageIds : task.outputImages)}>
      {src ? <img src={src} alt={reference ? '参考图' : getTaskPromptText(task.prompt, task.inputImageIds.length)} loading="lazy" /> : <span>{missing ? '暂时无法预览，点击查看原图' : '正在载入图片…'}</span>}
    </button>
    {!reference && <div className="studio-result-sidebar"><div className="studio-result-actions" aria-label={index ? `第 ${index} 张图片操作` : '图片操作'}>
      {index && <span className="studio-image-number">第 {index} 张</span>}
      <button onClick={() => void prepareStudioTask(task, 'edit', id)}><StudioActionIcon name="edit" />继续修改</button>
      <button aria-label="下载这张图片" onClick={() => { void downloadImageIds([id], downloadPrefix).then((result) => { if (result.failCount) useStore.getState().showToast('图片下载失败，请在详情中重试', 'error') }).catch((error) => useStore.getState().showToast(getDownloadErrorMessage(error), 'error')) }}><StudioActionIcon name="download" />下载</button>
      <button className={task.isFavorite ? 'studio-action-saved' : undefined} aria-label={task.isFavorite ? '管理图片收藏' : '收藏这张图片'} onClick={() => useStore.getState().openFavoritePicker([task.id])}><StudioActionIcon name="bookmark" />{task.isFavorite ? '已收藏' : '收藏'}</button>
      <button aria-label="用这张图片新建对话" title="开启新对话继续创作" onClick={() => void prepareStudioTask(task, 'fork', id)}><StudioActionIcon name="chat" />新建对话</button>
    </div>{roundActions}</div>}
  </div>
}

export function StudioTurn({ tasks, index }: { tasks: TaskRecord[]; index: number }) {
  const task = tasks[0]
  const [now, setNow] = useState(Date.now())
  const batchRunning = useStore((state) => Boolean(state.batchProgress))
  const running = tasks.some(isStudioTaskRunning)
  const active = tasks.find(isStudioTaskRunning)
  const total = getStudioRoundTotal(tasks)
  const images = tasks.flatMap((owner) => owner.outputImages.map((id) => ({ id, owner })))
  const errors = tasks.filter((item) => item.error || item.outputErrors?.length)
  const partial = errors.length > 0 || images.length < total
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const seconds = Math.floor(Math.max(0, running ? now - task.createdAt : Math.max(...tasks.map((item) => item.finishedAt ?? item.createdAt + (item.elapsed ?? 0))) - task.createdAt) / 1000)
  const roundActions = <div className="studio-round-actions" aria-label="本轮操作">
    {!running && <button disabled={batchRunning} onClick={() => requestRegenerateStudioTask(task)}><StudioActionIcon name="retry" />{images.length ? '再生成一轮' : '重试这一轮'}</button>}
    <details className="studio-round-details"><summary><StudioActionIcon name="settings" /><span>参数与详情</span><StudioActionIcon name="chevron" /></summary><div><p className="studio-round-size">{task.params.size}</p><p>本轮 {total} 张 · 已完成 {images.length} 张</p>{tasks.map((item, i) => <button key={item.id} onClick={() => useStore.getState().setDetailTaskId(item.id)}><span>第 {i + 1} 张 <span className={`studio-detail-status ${isStudioTaskRunning(item) ? 'is-running' : item.status === 'error' ? 'is-error' : 'is-done'}`}>{isStudioTaskRunning(item) ? '处理中' : item.status === 'error' ? '失败' : '已完成'}</span></span><StudioActionIcon name="arrow" /></button>)}</div></details>
    {!running && <details className="studio-round-more"><summary aria-label="更多本轮操作"><StudioActionIcon name="more" /><span>更多操作</span></summary><button disabled={batchRunning} className="studio-menu-danger" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); requestDeleteStudioTask(task) }}><StudioActionIcon name="trash" />删除本轮</button></details>}
  </div>
  return <article id={`studio-turn-${task.id}`} className="studio-turn" aria-label={`第 ${index + 1} 轮创作`}>
    <div className="studio-turn-request">
      <div className="studio-turn-label">第 {index + 1} 轮 <span>{new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
      <p data-selectable-text>{getTaskPromptText(task.prompt, task.inputImageIds.length)}</p>
      {task.inputImageIds.length > 0 && <div className="studio-turn-references" aria-label="本轮参考图">{task.inputImageIds.map((id) => <StudioImage key={id} id={id} task={task} reference />)}</div>}
      <div className="studio-turn-params"><span>{task.params.size} · {total} 张</span><button onClick={() => void prepareStudioTask(task, 'reuse', undefined, total)}>复用提示词</button></div>
    </div>
    <div className="studio-turn-response">
      <div className="studio-response-label"><span className="studio-response-mark" aria-hidden="true">✦</span><span>{siteConfig.name}</span><span className="studio-response-state">{running ? <MazalTaskStatus id={active?.customTaskId} recovering={active?.customRecoverable} /> : !images.length && errors.length ? '生成失败' : partial ? '部分完成' : '已完成'}{total > 1 && ` · ${images.length}/${total} 张`}{seconds > 0 && ` · ${seconds}s`}</span></div>
      {images.length > 0 && <div className="studio-turn-images">{images.map(({ id, owner }, i) => <StudioImage key={id} id={id} task={owner} index={total > 1 ? i + 1 : undefined} anchorId={owner.id !== task.id && id === owner.outputImages[0] ? `studio-turn-${owner.id}` : undefined} roundActions={i === images.length - 1 ? roundActions : undefined} />)}</div>}
      {running && <div className="studio-generating" role="status"><span className="studio-generating-dot" />{total > 1 ? `本轮共 ${total} 张，已完成 ${images.length} 张，其余图片将陆续显示在这里。` : '图片准备好后会保存在这个对话中，可以先去其他对话创作。连接中断时会继续查询原任务。'}</div>}
      {errors.map((item) => { const advice = getStudioFailureAdvice(item.error || item.outputErrors?.[0]?.error); return <div key={item.id} className="studio-turn-error"><strong>{total > 1 ? `第 ${tasks.indexOf(item) + 1} 张：` : ''}{advice.title}</strong><p>{advice.message}</p><details><summary>查看错误详情</summary><p role="alert" data-selectable-text>{item.error || item.outputErrors?.[0]?.error}</p></details><StudioHelpButton topic="failures">查看解决方法 ↗</StudioHelpButton></div> })}
      {!images.length && roundActions}
    </div>
  </article>
}

export default function StudioThread({ openSidebar }: { openSidebar: () => void }) {
  const tasks = useVisibleTasks()
  const activeId = useStore((state) => state.activeStudioConversationId)
  const focusedTaskId = useStore((state) => state.studioFocusedTaskId)
  const conversation = useStore((state) => state.studioConversations.find((item) => item.id === state.activeStudioConversationId))
  const current = tasks.filter((task) => getStudioConversationId(task) === activeId).sort((a, b) => a.createdAt - b.createdAt)
  const rounds = groupStudioRounds(current)
  const { threadRef, showJump, jumpToLatest } = useStudioThreadScroll(activeId, focusedTaskId, current[current.length - 1]?.id)
  useEffect(() => {
    if (!focusedTaskId) return
    useStore.setState({ studioFocusedTaskId: null })
  }, [focusedTaskId])
  return <section ref={threadRef} className="studio-thread">
    <div className="studio-thread-heading"><div><button className="studio-open-sidebar" aria-label="打开对话列表" onClick={openSidebar}>☰</button><h1>{conversation?.title || '新建对话'}</h1></div><span title="对话、作品和草稿仅保存在当前浏览器">自动保存到本机</span></div>
    <StudioWelcome />
    {current.length === 0 ? <div className="studio-thread-empty"><p className="studio-eyebrow">一个对话，一段创作</p><h2>Turn ideas into images</h2><p>写下你的想法，或添加参考图。每一轮尝试，都会留在这个对话里。</p><button className="studio-empty-templates" onClick={() => useStore.getState().setStudioView('templates')}>从灵感模板开始 ↗</button><div className="studio-thread-hints"><span>文字生成图片</span><span>参考图片创作</span><span>从结果继续修改</span></div></div> : <div className="studio-turn-list">{rounds.map((group, index) => <StudioTurn key={group[0].studioRoundId || group[0].id} tasks={group} index={index} />)}</div>}
    {showJump && current.length > 0 && <button className="studio-jump-latest" onClick={jumpToLatest}>跳到最新创作 ↓</button>}
    <div className="studio-thread-end" />
  </section>
}
