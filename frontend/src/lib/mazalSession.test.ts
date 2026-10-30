import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('主站内嵌登录', () => {
  it('只在内存保存交接密钥，不读取独立站已保存的身份', async () => {
    vi.stubGlobal('window', { location: { search: '?embed=mazal' }, parent: {} })
    const storage = { getItem: vi.fn(() => 'old-independent-key'), setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    const session = await import('./mazalSession')
    expect(session.isMazalEmbedded).toBe(true)
    expect(session.getMazalKey()).toBe('')
    session.saveMazalSession('temporary-selected-key', { subject_id: 'selected-user-key' } as Parameters<typeof session.saveMazalSession>[1], true)
    expect(session.getMazalKey()).toBe('temporary-selected-key')
    expect(session.mazalStorageName()).toBe('mazal-image-selected-user-key')
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('独立站保留原有的会话登录', async () => {
    const page = { location: { search: '' }, parent: null as unknown }
    page.parent = page
    vi.stubGlobal('window', page)
    vi.stubGlobal('sessionStorage', { getItem: () => 'independent-key' })
    const session = await import('./mazalSession')
    expect(session.isMazalEmbedded).toBe(false)
    expect(session.getMazalKey()).toBe('independent-key')
  })
})
