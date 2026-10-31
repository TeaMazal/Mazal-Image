import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('site runtime configuration', () => {
  it('keeps the site download name and existing welcome preference key', async () => {
    vi.stubGlobal('window', { __MAZAL_IMAGE_CONFIG__: { name: 'Site A', mainOrigin: 'https://main-a.example.test', downloadPrefix: 'Site-A', guideStorageKey: 'site-a-guide-v1' } })
    const { downloadPrefix, guideStorageKey } = await import('./siteConfig')
    expect(downloadPrefix).toBe('Site-A')
    expect(guideStorageKey).toBe('site-a-guide-v1')
  })
  it.each([
    ['Site A', 'https://main-a.example.test'],
    ['Site B', 'https://main-b.example.test'],
  ])('uses %s without rebuilding the frontend', async (name, mainOrigin) => {
    vi.stubGlobal('window', { __MAZAL_IMAGE_CONFIG__: { name, mainOrigin } })
    const { siteConfig } = await import('./siteConfig')
    expect(siteConfig).toEqual({ name, mainOrigin })
  })
})
