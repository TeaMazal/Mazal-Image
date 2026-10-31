import { useEffect, useState } from 'react'
import { mazalTaskEvents, mazalTaskStates } from '../lib/mazalApi'

export default function MazalTaskStatus({ id, recovering = false }: { id?: string; recovering?: boolean }) {
  const [status, setStatus] = useState(id ? mazalTaskStates.get(id) : undefined)
  useEffect(() => {
    const update = () => setStatus(id ? mazalTaskStates.get(id) : undefined)
    update()
    mazalTaskEvents.addEventListener('change', update)
    return () => mazalTaskEvents.removeEventListener('change', update)
  }, [id])
  const label = status === 'queued' ? '排队等待中…' : status === 'running' ? '正在生成…' : status === 'fetching' || status === 'success' ? '正在获取并保存图片…' : status === 'recovering' || recovering ? '正在查询原任务…' : '正在提交任务…'
  return <span role="status">{label}</span>
}
