import type { TaskParams } from '../types'

export interface InspirationTemplate {
  id: string
  title: string
  description: string
  category: string
  tags: string[]
  cover: string
  prompt: string
  fields: { key: string; label: string; default: string; placeholder: string; required: boolean }[]
  reference_required: boolean
  size: TaskParams['size']
  source_name: string
  source_url: string
  license: string
  preview_note: string
}

export function parseTemplateLibrary(value: unknown): InspirationTemplate[] {
  if (!value || typeof value !== 'object' || !('templates' in value) || !Array.isArray(value.templates)) throw new Error('模板数据格式无效')
  return value.templates.filter((item): item is InspirationTemplate => {
    if (!item || typeof item !== 'object') return false
    if (!['id', 'title', 'description', 'category', 'prompt', 'cover', 'source_name', 'source_url', 'license', 'preview_note'].every((key) => typeof item[key] === 'string')) return false
    if (item.cover && !/^\/template-media\/[a-f0-9]{64}\.webp$/.test(item.cover)) return false
    if (item.source_url) {
      try {
        const url = new URL(item.source_url)
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
      } catch { return false }
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) || !item.title.trim() || !item.prompt.trim() || item.prompt.length > 12000 || typeof item.reference_required !== 'boolean') return false
    if (!['auto', '1024x1024', '1024x1536', '1536x1024'].includes(item.size)) return false
    if (!Array.isArray(item.tags) || item.tags.length > 8 || !item.tags.every((tag: unknown) => typeof tag === 'string' && tag.length <= 24)) return false
    if (!Array.isArray(item.fields) || item.fields.length > 8 || !item.fields.every((field: InspirationTemplate['fields'][number]) => field && ['key', 'label', 'default', 'placeholder'].every((key) => typeof (field as unknown as Record<string, unknown>)[key] === 'string') && /^[a-z][a-z0-9_]{0,31}$/.test(field.key) && Boolean(field.label.trim()) && typeof field.required === 'boolean')) return false
    const keys = new Set(item.fields.map((field: InspirationTemplate['fields'][number]) => field.key))
    return keys.size === item.fields.length && [...item.prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].every((match) => keys.has(match[1]))
  })
}

export function fillTemplate(item: InspirationTemplate, values: Record<string, string>) {
  for (const field of item.fields) {
    if (field.required && !values[field.key]?.trim()) throw new Error(`请填写${field.label}`)
    if ((values[field.key]?.length ?? 0) > 500) throw new Error(`${field.label}最多 500 字`)
  }
  const prompt = item.prompt.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key: string) => values[key]?.trim() || '')
  if (prompt.length > 16000) throw new Error('填写后的提示词超过 16000 字，请缩短填写内容')
  return prompt
}

export function canAdoptOptimizedPrompt(target: string | null, current: string | null, original: string, prompt: string, referenceIds: string[], currentReferenceIds: string[]) {
  return Boolean(target && target === current && original === prompt && referenceIds.join('\n') === currentReferenceIds.join('\n'))
}
