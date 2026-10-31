import { MAX_INPUT_IMAGES, type AppSettings, type InputImage, type StudioConversation, type StudioDraft, type StudioView, type TaskParams, type TaskRecord } from '../types'
import { normalizeAgentInputDraft, restoreGalleryInputDraftState } from './inputDraftState'
import { normalizeParams } from './persistedState'
import { getTaskPromptText } from './promptImageMentions'

export const LEGACY_STUDIO_CONVERSATION_ID = 'studio-legacy'

export interface StudioData {
  studioConversations: StudioConversation[]
  activeStudioConversationId: string | null
}

export interface StudioSlice extends StudioData {
  studioView: StudioView
  studioFocusedTaskId: string | null
  initializeStudioConversations: () => void
  createStudioConversation: () => string
  setActiveStudioConversationId: (id: string) => void
  setStudioView: (view: StudioView) => void
  renameStudioConversation: (id: string, title: string) => void
  toggleStudioConversationPin: (id: string) => void
  patchStudioDraft: (id: string, patch: Partial<StudioDraft>) => void
  addStudioReference: (id: string, image: InputImage) => void
  forgetStudioConversation: (id: string) => void
}

type StudioHost = StudioSlice & StudioDraft & {
  tasks: TaskRecord[]
  settings: AppSettings
}

export function getStudioConversationId(task: TaskRecord) {
  return task.studioConversationId || LEGACY_STUDIO_CONVERSATION_ID
}

export function getStudioConversationTitle(task: Pick<TaskRecord, 'prompt' | 'inputImageIds'>) {
  const text = getTaskPromptText(task.prompt, task.inputImageIds.length).replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  return characters.length > 24 ? `${characters.slice(0, 24).join('').replace(/[，、,；;：:]$/, '')}…` : text || '图片创作'
}

export function newStudioConversation(params: TaskParams, now = Date.now()): StudioConversation {
  return {
    id: crypto.randomUUID(),
    title: '新建对话',
    autoTitle: true,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    draft: { prompt: '', inputImages: [], maskDraft: null, maskEditorImageId: null, params: { ...params } },
  }
}

export function captureStudioDraft(state: StudioData & StudioDraft) {
  return state.studioConversations.map((conversation) => conversation.id === state.activeStudioConversationId
    ? { ...conversation, draft: { prompt: state.prompt, inputImages: state.inputImages, maskDraft: state.maskDraft, maskEditorImageId: state.maskEditorImageId, params: state.params } }
    : conversation)
}

export function restoreStudioDraft(draft: StudioDraft) {
  return {
    ...restoreGalleryInputDraftState(draft),
    params: { ...draft.params },
    galleryInputDraft: { ...draft },
    promptSelection: null,
    reusedTaskApiProfileId: null,
    reusedTaskApiProfileName: null,
    reusedTaskApiProfileMissing: false,
    reusedTaskApiModel: null,
    selectedTaskIds: [],
    selectedFavoriteCollectionIds: [],
  }
}

export function normalizeStudioData(value: unknown, params: TaskParams): StudioData {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const seen = new Set<string>()
  const conversations: StudioConversation[] = []
  for (const entry of Array.isArray(source.studioConversations) ? source.studioConversations : []) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    const draft = item.draft && typeof item.draft === 'object' ? item.draft as Record<string, unknown> : {}
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    conversations.push({
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 80) : '新建对话',
      autoTitle: item.autoTitle === true,
      pinned: item.pinned === true,
      createdAt,
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt,
      draft: { ...normalizeAgentInputDraft(draft), params: normalizeParams(draft.params, params) },
    })
  }
  return {
    studioConversations: conversations,
    activeStudioConversationId: conversations.some((conversation) => conversation.id === source.activeStudioConversationId)
      ? source.activeStudioConversationId as string
      : null,
  }
}

export function getPersistedStudioData(state: StudioData & StudioDraft & { settings: AppSettings }) {
  if (!state.studioConversations.length) return {}
  return {
    activeStudioConversationId: state.activeStudioConversationId,
    studioConversations: captureStudioDraft(state).map((conversation) => ({
      ...conversation,
      draft: state.settings.persistInputOnRestart
        ? { ...conversation.draft, inputImages: conversation.draft.inputImages.map((image) => ({ id: image.id, dataUrl: '' })) }
        : { prompt: '', inputImages: [], maskDraft: null, maskEditorImageId: null, params: conversation.draft.params },
    })),
  }
}

export function reconcileStudioTasks(conversations: StudioConversation[], tasks: TaskRecord[], params: TaskParams) {
  let next = conversations
  for (const task of tasks) {
    const id = getStudioConversationId(task)
    const existing = next.find((conversation) => conversation.id === id)
    if (!existing) {
      const conversation = newStudioConversation(params, task.createdAt)
      next = [...next, { ...conversation, id, title: id === LEGACY_STUDIO_CONVERSATION_ID ? '以前的创作' : getStudioConversationTitle(task), autoTitle: false }]
    } else if (existing.autoTitle || task.createdAt > existing.updatedAt) {
      next = next.map((conversation) => conversation.id === id ? {
        ...conversation,
        title: conversation.autoTitle ? getStudioConversationTitle(task) : conversation.title,
        autoTitle: false,
        updatedAt: Math.max(conversation.updatedAt, task.createdAt),
      } : conversation)
    }
  }
  return next
}

export function getStudioDraftImageIds(state: StudioData) {
  return state.studioConversations.flatMap((conversation) => conversation.draft.inputImages.map((image) => image.id))
}

export function createStudioSlice(set: (patch: Partial<StudioHost> & Record<string, unknown>) => void, get: () => StudioHost): StudioSlice {
  return {
    studioConversations: [],
    activeStudioConversationId: null,
    studioView: 'create',
    studioFocusedTaskId: null,
    initializeStudioConversations: () => {
      set({ studioFocusedTaskId: null })
      const state = get()
      let conversations = reconcileStudioTasks(state.studioConversations, state.tasks, state.params)
      if (!state.studioConversations.length) {
        if (conversations.length) {
          conversations = captureStudioDraft({ ...state, studioConversations: conversations, activeStudioConversationId: LEGACY_STUDIO_CONVERSATION_ID })
        }
        const conversation = newStudioConversation(state.params)
        if (!conversations.length) conversation.draft = { prompt: state.prompt, inputImages: state.inputImages, maskDraft: state.maskDraft, maskEditorImageId: state.maskEditorImageId, params: state.params }
        conversations = [conversation, ...conversations]
        set({ studioConversations: conversations, activeStudioConversationId: conversation.id, ...restoreStudioDraft(conversation.draft) })
        return
      }
      const id = state.activeStudioConversationId ?? conversations[0].id
      const active = conversations.find((conversation) => conversation.id === id) ?? conversations[0]
      set({ studioConversations: conversations, activeStudioConversationId: active.id, ...restoreStudioDraft(active.draft) })
    },
    createStudioConversation: () => {
      const state = get()
      const conversation = newStudioConversation(state.params)
      set({ studioConversations: [conversation, ...captureStudioDraft(state)], activeStudioConversationId: conversation.id, studioView: 'create', studioFocusedTaskId: null, ...restoreStudioDraft(conversation.draft) })
      return conversation.id
    },
    setActiveStudioConversationId: (id) => {
      const state = get()
      const conversations = captureStudioDraft(state)
      const conversation = conversations.find((item) => item.id === id)
      if (!conversation) return
      set({ studioConversations: conversations, activeStudioConversationId: id, studioView: 'create', studioFocusedTaskId: null, ...restoreStudioDraft(conversation.draft) })
    },
    setStudioView: (studioView) => set({ studioView, studioFocusedTaskId: null, filterFavorite: studioView === 'favorites', activeFavoriteCollectionId: null, selectedTaskIds: [], selectedFavoriteCollectionIds: [], searchQuery: '', filterStatus: 'all' }),
    renameStudioConversation: (id, title) => {
      const text = title.trim().slice(0, 80)
      if (!text) return
      set({ studioConversations: captureStudioDraft(get()).map((conversation) => conversation.id === id ? { ...conversation, title: text, autoTitle: false } : conversation) })
    },
    toggleStudioConversationPin: (id) => set({ studioConversations: captureStudioDraft(get()).map((conversation) => conversation.id === id ? { ...conversation, pinned: !conversation.pinned } : conversation) }),
    patchStudioDraft: (id, patch) => {
      const state = get()
      const conversations = captureStudioDraft(state)
      const conversation = conversations.find((item) => item.id === id)
      if (!conversation) return
      const draft = { ...conversation.draft, ...patch }
      set({ studioConversations: conversations.map((item) => item.id === id ? { ...item, draft } : item), ...(state.activeStudioConversationId === id ? restoreStudioDraft(draft) : {}) })
    },
    addStudioReference: (id, image) => {
      const state = get()
      const draft = state.activeStudioConversationId === id ? state : state.studioConversations.find((conversation) => conversation.id === id)?.draft
      if (!draft || draft.inputImages.some((item) => item.id === image.id)) return
      if (draft.inputImages.length >= MAX_INPUT_IMAGES) throw new Error(`参考图最多 ${MAX_INPUT_IMAGES} 张`)
      state.patchStudioDraft(id, { inputImages: [...draft.inputImages, image] })
    },
    forgetStudioConversation: (id) => {
      const state = get()
      const conversations = captureStudioDraft(state).filter((conversation) => conversation.id !== id)
      if (!conversations.length) conversations.push(newStudioConversation(state.params))
      const active = conversations.find((conversation) => conversation.id === state.activeStudioConversationId) ?? conversations[0]
      set({ studioConversations: conversations, activeStudioConversationId: active.id, ...(state.activeStudioConversationId === id ? restoreStudioDraft(active.draft) : {}) })
    },
  }
}
