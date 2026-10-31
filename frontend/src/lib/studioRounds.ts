import type { TaskRecord } from '../types'
import { getStudioConversationId } from './studioConversations'

export function getStudioRoundTasks(tasks: TaskRecord[], source: TaskRecord) {
  return tasks.filter((task) => source.studioRoundId
    ? task.studioRoundId === source.studioRoundId && getStudioConversationId(task) === getStudioConversationId(source)
    : task.id === source.id).sort((a, b) => (a.studioRoundIndex ?? 0) - (b.studioRoundIndex ?? 0) || a.createdAt - b.createdAt)
}

export function groupStudioRounds(tasks: TaskRecord[]) {
  const groups = new Map<string, TaskRecord[]>()
  for (const task of [...tasks].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = JSON.stringify([getStudioConversationId(task), task.studioRoundId ? 'round' : 'task', task.studioRoundId || task.id])
    const group = groups.get(key)
    if (group) group.push(task)
    else groups.set(key, [task])
  }
  return [...groups.values()].map((group) => group.sort((a, b) => (a.studioRoundIndex ?? 0) - (b.studioRoundIndex ?? 0) || a.createdAt - b.createdAt))
}

export function getStudioRoundTotal(tasks: TaskRecord[]) {
  return Math.max(tasks.length, tasks.reduce((n, task) => n + task.outputImages.length, 0), ...tasks.map((task) => Number.isInteger(task.studioRoundTotal) && task.studioRoundTotal! > 0 && task.studioRoundTotal! <= 16 ? task.studioRoundTotal! : task.params.n))
}

export function isStudioTaskRunning(task: TaskRecord) {
  return task.status === 'running' || Boolean(task.customRecoverable || task.falRecoverable)
}
