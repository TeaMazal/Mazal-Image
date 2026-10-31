import type { InputImage, TaskRecord } from '../types'
import { removeMultipleTasks, retryStudioRound, useStore } from '../store'
import { getStudioRoundTasks, getStudioRoundTotal, groupStudioRounds, isStudioTaskRunning } from './studioRounds'
import { ensureImageCached } from './imageCache'
import { normalizeParamsForSettings } from './paramCompatibility'
import { getStudioConversationId, reconcileStudioTasks } from './studioConversations'
import { remapImageMentionsForOrder } from './promptImageMentions'

export function openStudioTask(task: TaskRecord) {
  const state = useStore.getState()
  const studioConversations = reconcileStudioTasks(state.studioConversations, [task], state.params)
  if (studioConversations !== state.studioConversations) useStore.setState({ studioConversations })
  state.setActiveStudioConversationId(getStudioConversationId(task))
  useStore.setState({ studioFocusedTaskId: task.id })
  state.setDetailTaskId(null)
}

export async function prepareStudioTask(task: TaskRecord, mode: 'reuse' | 'edit' | 'fork', imageId?: string, roundTotal?: number) {
  if (mode !== 'reuse' && !task.outputImages.length) return
  const state = useStore.getState()
  const conversationId = mode === 'fork' ? state.createStudioConversation() : getStudioConversationId(task)
  if (mode !== 'fork') openStudioTask(task)
  const ids = mode === 'reuse' ? task.inputImageIds : imageId ? [imageId] : task.outputImages
  try {
    const inputImages: InputImage[] = []
    for (const id of ids) {
      const dataUrl = await ensureImageCached(id)
      if (dataUrl) inputImages.push({ id, dataUrl })
    }
    if (mode !== 'reuse' && inputImages.length === 0) {
      state.showToast('原图暂时无法读取，请重新添加参考图', 'error')
      return
    }
    let maskDraft = null
    if (mode === 'reuse' && task.maskImageId && task.maskTargetImageId && inputImages.some((image) => image.id === task.maskTargetImageId)) {
      const maskDataUrl = await ensureImageCached(task.maskImageId)
      if (maskDataUrl) maskDraft = { targetImageId: task.maskTargetImageId, maskDataUrl, updatedAt: Date.now() }
    }
    useStore.getState().patchStudioDraft(conversationId, {
      prompt: mode === 'reuse' ? remapImageMentionsForOrder(task.prompt, task.inputImageIds.map((id) => ({ id, dataUrl: '' })), inputImages) : '',
      inputImages,
      params: normalizeParamsForSettings({ ...task.params, ...(mode === 'reuse' && roundTotal ? { n: roundTotal } : {}) }, useStore.getState().settings, { hasInputImages: inputImages.length > 0 }),
      maskDraft,
      maskEditorImageId: null,
    })
    if (useStore.getState().activeStudioConversationId === conversationId) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-bar] [contenteditable="true"]')?.focus())
    }
    state.showToast(mode === 'reuse' ? '提示词和参数已恢复' : '参考图已就位，描述你想修改的地方', 'success')
  } catch (error) {
    state.showToast(`读取参考图失败：${error instanceof Error ? error.message : String(error)}`, 'error')
  }
}

export function requestDeleteStudioConversation(id: string) {
  const state = useStore.getState()
  const tasks = state.tasks.filter((task) => getStudioConversationId(task) === id)
  if (tasks.some((task) => task.status === 'running' || task.customRecoverable || task.falRecoverable) || state.batchProgress) {
    state.showToast('请等生成任务结束后再删除对话', 'info')
    return
  }
  state.setConfirmDialog({
    title: '删除这个对话？',
    message: `将删除「${state.studioConversations.find((item) => item.id === id)?.title || '这个对话'}」的草稿、${groupStudioRounds(tasks).length} 轮记录及 ${tasks.reduce((count, task) => count + task.outputImages.length, 0)} 张图片。画廊和收藏夹中的对应作品也会移除；其他对话正在引用的图片会保留。此操作无法撤销，重要作品请先导出备份。`,
    confirmText: '删除对话',
    tone: 'danger',
    action: async () => {
      const latest = useStore.getState()
      const current = latest.tasks.filter((task) => getStudioConversationId(task) === id)
      if (latest.batchProgress || current.some((task) => task.status === 'running' || task.customRecoverable || task.falRecoverable)) {
        latest.showToast('这个对话还有生成任务，请稍后再删除', 'info')
        return
      }
      await removeMultipleTasks(current.map((task) => task.id))
      useStore.getState().forgetStudioConversation(id)
    },
  })
}

export function requestRegenerateStudioTask(task: TaskRecord) {
  const state = useStore.getState()
  const tasks = getStudioRoundTasks(state.tasks, task)
  if (!tasks.length || state.batchProgress || tasks.some(isStudioTaskRunning)) return
  state.setConfirmDialog({
    title: '再生成这一轮？',
    message: `使用本轮的提示词、参考图和参数生成新一轮，共 ${getStudioRoundTotal(tasks)} 张，原有记录和图片会保留。将发起新的生图请求，成功返回的图片按当前密钥所属分组计费。`,
    confirmText: '生成新一轮',
    action: async () => {
      const source = useStore.getState().tasks.find((item) => item.id === task.id)
      if (!source || source.status === 'running' || source.customRecoverable || source.falRecoverable) return
      await retryStudioRound(source)
    },
  })
}

export function requestDeleteStudioTask(task: TaskRecord) {
  const state = useStore.getState()
  const tasks = getStudioRoundTasks(state.tasks, task)
  if (!tasks.length || tasks.some(isStudioTaskRunning) || state.batchProgress) return
  state.setConfirmDialog({
    title: '删除这一轮创作？',
    message: `将从当前浏览器删除这一轮记录及 ${tasks.reduce((count, item) => count + item.outputImages.length, 0)} 张图片，画廊和收藏夹中的对应作品也会移除。其他轮次的记录和正在引用的图片会保留。此操作无法撤销，已产生的费用不会因删除记录而退还。`,
    confirmText: '删除本轮',
    tone: 'danger',
    action: async () => {
      const latest = useStore.getState()
      const current = getStudioRoundTasks(latest.tasks, task)
      if (!current.length || latest.batchProgress || current.some(isStudioTaskRunning)) return
      await removeMultipleTasks(current.map((item) => item.id))
    },
  })
}
