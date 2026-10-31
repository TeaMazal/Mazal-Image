import { describe, expect, it } from 'vitest'
import { canAdoptOptimizedPrompt, fillTemplate, parseTemplateLibrary, type InspirationTemplate } from './templateLibrary'
import { DEFAULT_PARAMS, type StudioDraft, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { createStudioSlice, type StudioSlice } from './studioConversations'

const template: InspirationTemplate = {
  id: 'sample', title: '商品', description: '', category: '电商商品', tags: [], cover: '',
  prompt: '主体：{{subject}}，文字：{{text}}，重复主体：{{subject}}',
  fields: [{ key: 'subject', label: '主体', default: '', placeholder: '', required: true }, { key: 'text', label: '文字', default: '', placeholder: '', required: false }],
  reference_required: true, size: '1024x1024', source_name: '', source_url: '', license: '', preview_note: '',
}

describe('灵感模板与异步优化保护', () => {
  it('按字面填写变量，拒绝遗漏必填项且不递归替换用户文字', () => {
    expect(() => fillTemplate(template, {})).toThrow('请填写主体')
    expect(fillTemplate(template, { subject: '$& {{text}}', text: '测试' })).toBe('主体：$& {{text}}，文字：测试，重复主体：$& {{text}}')
    expect(() => fillTemplate(template, { subject: 'a'.repeat(501) })).toThrow('最多 500 字')
  })
  it('拒绝远程封面及不安全的来源链接', () => {
    expect(parseTemplateLibrary({ templates: [template, { ...template, cover: 'https://tracker.invalid/image.png' }, { ...template, source_url: 'javascript:alert(1)' }] })).toEqual([template])
    expect(() => parseTemplateLibrary(null)).toThrow()
    expect(parseTemplateLibrary({ templates: [
      { ...template, source_url: 'https://user:password@example.com' },
      { ...template, fields: [template.fields[0], template.fields[0]] },
      { ...template, prompt: '{{undefined}}' },
      { ...template, fields: [{ ...template.fields[0], required: 'false' }] },
    ] })).toEqual([])
  })
  it('替换重复变量后仍执行生图提示词长度限制', () => {
    expect(() => fillTemplate({ ...template, prompt: '{{subject}}'.repeat(33) }, { subject: '字'.repeat(500) })).toThrow('16000')
  })
  it('新对话应用模板后，原有文字、参考图与历史仍归原对话', () => {
    let state: StudioSlice & StudioDraft & { tasks: TaskRecord[]; settings: typeof DEFAULT_SETTINGS } = {
      prompt: '', inputImages: [], maskDraft: null, maskEditorImageId: null, params: DEFAULT_PARAMS,
      tasks: [], settings: DEFAULT_SETTINGS,
      ...createStudioSlice((patch) => { state = { ...state, ...patch } }, () => state),
    }
    state.initializeStudioConversations()
    const original = state.activeStudioConversationId!
    const reference = { id: 'reference', dataUrl: 'data:image/png;base64,AA==' }
    state.patchStudioDraft(original, { prompt: '原来草稿', inputImages: [reference], params: { ...DEFAULT_PARAMS, n: 3 } })
    state.setStudioView('templates')
    const target = state.createStudioConversation()
    state.patchStudioDraft(target, { prompt: fillTemplate(template, { subject: '水杯' }) })
    expect(state.inputImages).toEqual([])
    expect(state.tasks).toEqual([])
    state.setActiveStudioConversationId(original)
    expect(state.prompt).toBe('原来草稿')
    expect(state.inputImages).toEqual([reference])
    expect(state.params.n).toBe(3)
  })
  it('优化结果仅允许在原对话、原文、原参考图都未改变时采用', () => {
    expect(canAdoptOptimizedPrompt('a', 'a', '原文', '原文', ['ref'], ['ref'])).toBe(true)
    expect(canAdoptOptimizedPrompt('a', 'b', '原文', '原文', ['ref'], ['ref'])).toBe(false)
    expect(canAdoptOptimizedPrompt('a', 'a', '原文', '新文', ['ref'], ['ref'])).toBe(false)
    expect(canAdoptOptimizedPrompt('a', 'a', '原文', '原文', ['ref'], [])).toBe(false)
    expect(canAdoptOptimizedPrompt(null, null, '', '', [], [])).toBe(false)
  })
})
