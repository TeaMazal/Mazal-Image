import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('site runtime configuration', () => {
  it.each([
    ['Site A', 'https://main-a.example.test'],
    ['Site B', 'https://main-b.example.test'],
  ])('uses %s without rebuilding the frontend', async (name, mainOrigin) => {
    vi.stubGlobal('window', { __MAZAL_IMAGE_CONFIG__: { name, mainOrigin } })
    const { siteConfig } = await import('./siteConfig')
    expect(siteConfig).toEqual({ name, mainOrigin })
  })
})
