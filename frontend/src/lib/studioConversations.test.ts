import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type StudioDraft, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { captureStudioDraft, createStudioSlice, getPersistedStudioData, getStudioConversationTitle, getStudioDraftImageIds, newStudioConversation, normalizeStudioData, reconcileStudioTasks, type StudioSlice } from './studioConversations'

function studio() {
  const conversation = newStudioConversation(DEFAULT_PARAMS, 1)
  let state: StudioSlice & StudioDraft & { tasks: TaskRecord[]; settings: typeof DEFAULT_SETTINGS } = {
    ...conversation.draft,
    tasks: [] as TaskRecord[],
    settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: true },
    ...createStudioSlice((patch) => { state = { ...state, ...patch } }, () => state),
  }
  state.initializeStudioConversations()
  return { get: () => state, patch: (patch: Partial<typeof state>) => { state = { ...state, ...patch } } }
}

describe('customer studio conversations', () => {
  it('creates readable titles without splitting Unicode characters', () => {
    expect(getStudioConversationTitle({ prompt: '  橘猫\n  窗台   花园 ', inputImageIds: [] })).toBe('橘猫 窗台 花园')
    expect(getStudioConversationTitle({ prompt: '🐈'.repeat(25), inputImageIds: [] })).toBe('🐈'.repeat(24) + '…')
    expect(getStudioConversationTitle({ prompt: '', inputImageIds: [] })).toBe('图片创作')
  })
  it('keeps separate prompts, references, masks and parameters when switching', () => {
    const app = studio()
    const a = app.get().activeStudioConversationId!
    const image = { id: 'reference-a', dataUrl: 'data:image/png;base64,YQ==' }
    app.patch({ prompt: '草稿 A', inputImages: [image], params: { ...DEFAULT_PARAMS, n: 3 } })
    const b = app.get().createStudioConversation()
    expect(app.get().prompt).toBe('')
    expect(app.get().inputImages).toEqual([])
    app.patch({ prompt: '草稿 B', params: { ...DEFAULT_PARAMS, n: 1 } })
    app.get().setActiveStudioConversationId(a)
    expect(app.get().prompt).toBe('草稿 A')
    expect(app.get().inputImages).toEqual([image])
    expect(app.get().params.n).toBe(3)
    app.get().setActiveStudioConversationId(b)
    expect(app.get().prompt).toBe('草稿 B')
    expect(app.get().params.n).toBe(1)
  })

  it('routes delayed reference uploads and edits to their original draft', () => {
    const app = studio()
    const a = app.get().activeStudioConversationId!
    const b = app.get().createStudioConversation()
    app.patch({ prompt: '保持 B' })
    app.get().addStudioReference(a, { id: 'late', dataUrl: 'data:image/png;base64,YQ==' })
    app.get().patchStudioDraft(a, { prompt: '延迟的 A' })
    expect(app.get().activeStudioConversationId).toBe(b)
    expect(app.get().prompt).toBe('保持 B')
    expect(app.get().inputImages).toEqual([])
    app.get().setActiveStudioConversationId(a)
    expect(app.get().prompt).toBe('延迟的 A')
    expect(app.get().inputImages[0].id).toBe('late')
  })

  it('persists the active draft and only reference IDs, then normalizes it', () => {
    const app = studio()
    app.patch({ prompt: '刷新后保留', inputImages: [{ id: 'ref', dataUrl: 'data:image/png;base64,YQ==' }] })
    const saved = getPersistedStudioData(app.get())
    expect(saved.studioConversations?.[0].draft.prompt).toBe('刷新后保留')
    expect(saved.studioConversations?.[0].draft.inputImages).toEqual([{ id: 'ref', dataUrl: '' }])
    const restored = normalizeStudioData(JSON.parse(JSON.stringify(saved)), DEFAULT_PARAMS)
    expect(restored.activeStudioConversationId).toBe(app.get().activeStudioConversationId)
    expect(restored.studioConversations[0].draft.prompt).toBe('刷新后保留')
    expect(getStudioDraftImageIds(restored)).toEqual(['ref'])
  })

  it('respects the setting to discard drafts on restart', () => {
    const app = studio()
    app.patch({ prompt: '不持久化', settings: { ...app.get().settings, persistInputOnRestart: false } })
    expect(getPersistedStudioData(app.get()).studioConversations?.[0].draft.prompt).toBe('')
    expect(captureStudioDraft(app.get())[0].draft.prompt).toBe('不持久化')
  })

  it('groups old records and preserves distinct imported conversation IDs', () => {
    const base: TaskRecord = { id: 'old', prompt: '以前的作品', inputImageIds: [], createdAt: 1, params: DEFAULT_PARAMS, outputImages: [], status: 'done', error: null, finishedAt: 2, elapsed: 1 }
    const records = [base, { ...base, id: 'new', studioConversationId: 'imported', prompt: '风景', createdAt: 2 }]
    const conversations = reconcileStudioTasks([], records, DEFAULT_PARAMS)
    expect(conversations.map((item) => item.id)).toEqual(['studio-legacy', 'imported'])
    expect(conversations[0].title).toBe('以前的创作')
    expect(conversations[1].title).toBe('风景')
    expect(reconcileStudioTasks(conversations, records, DEFAULT_PARAMS)).toEqual(conversations)
  })

  it('rejects malformed and duplicate persisted metadata', () => {
    const conversation = newStudioConversation(DEFAULT_PARAMS, 1)
    const restored = normalizeStudioData({ studioConversations: [null, {}, conversation, conversation], activeStudioConversationId: 'missing' }, DEFAULT_PARAMS)
    expect(restored.studioConversations).toHaveLength(1)
    expect(restored.activeStudioConversationId).toBeNull()
    expect(normalizeStudioData(null, DEFAULT_PARAMS).studioConversations).toEqual([])
  })

  it('preserves explicit names and pin state when new tasks arrive', () => {
    const app = studio()
    const id = app.get().activeStudioConversationId!
    app.get().renameStudioConversation(id, '产品方案')
    app.get().toggleStudioConversationPin(id)
    const updated = reconcileStudioTasks(app.get().studioConversations, [{ studioConversationId: id, createdAt: Date.now() + 1, prompt: '另一张图', inputImageIds: [] } as unknown as TaskRecord], DEFAULT_PARAMS)
    expect(updated[0]).toMatchObject({ title: '产品方案', pinned: true, autoTitle: false })
  })
})
