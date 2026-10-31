import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVisibleTasks } from '../hooks/usePrivacyMode'
import { openStudioTask } from '../lib/studioActions'
import { getStudioConversationId } from '../lib/studioConversations'
import { getStudioTaskPhase } from '../lib/studioFeedback'

export default function StudioCompletionNotice() {
  const tasks = useVisibleTasks()
  const conversations = useStore((state) => state.studioConversations)
  const previous = useRef(new Map(tasks.map((task) => [task.id, getStudioTaskPhase(task)])))
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    const finished = tasks.filter((task) => previous.current.get(task.id) === 'running' && getStudioTaskPhase(task) !== 'running')
    previous.current = new Map(tasks.map((task) => [task.id, getStudioTaskPhase(task)]))
    if (finished.length) setIds((current) => [...new Set([...current, ...finished.map((task) => task.id)])].slice(-3))
  }, [tasks])
  const visible = ids.flatMap((id) => tasks.find((task) => task.id === id) ?? [])
  if (!visible.length) return null
  return <aside className="studio-completions" aria-label="生成任务通知" aria-live="polite">
    {visible.map((task) => <div className="studio-completion" key={task.id}>
      <div><strong>{conversations.find((item) => item.id === getStudioConversationId(task))?.title || '图片创作'}</strong><p>{task.outputImages.length ? `${task.outputImages.length} 张图片已就绪${task.outputErrors?.length ? '，部分图片失败' : ''}` : '本轮未生成图片，查看详情后处理'}</p></div>
      <button className="studio-completion-open" onClick={() => { openStudioTask(task); setIds((current) => current.filter((id) => id !== task.id)) }}>{task.outputImages.length ? '查看结果' : '查看任务'} ↗</button>
      <button className="studio-completion-close" aria-label="关闭这条任务通知" onClick={() => setIds((current) => current.filter((id) => id !== task.id))}>×</button>
    </div>)}
  </aside>
}
