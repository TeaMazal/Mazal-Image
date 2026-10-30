import { useEffect, useState } from 'react'
import { mazalTaskEvents, mazalTaskStates } from '../lib/mazalApi'

export default function MazalTaskStatus({ id }: { id?: string }) {
  const [status, setStatus] = useState(id ? mazalTaskStates.get(id) : undefined)
  useEffect(() => {
    const update = () => setStatus(id ? mazalTaskStates.get(id) : undefined)
    update()
    mazalTaskEvents.addEventListener('change', update)
    return () => mazalTaskEvents.removeEventListener('change', update)
  }, [id])
  return <span className="text-xs text-gray-500" role="status">{status === 'queued' ? '排队等待中…' : status === 'running' ? '正在生成…' : '正在连接任务…'}</span>
}
