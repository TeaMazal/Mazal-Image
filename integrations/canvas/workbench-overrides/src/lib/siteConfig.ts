declare global {
  interface Window {
    __MAZAL_IMAGE_CONFIG__?: { name: string; mainOrigin: string; downloadPrefix?: string; guideStorageKey?: string }
  }
}
const runtime = typeof window !== 'undefined' ? window.__MAZAL_IMAGE_CONFIG__ : undefined
export const downloadPrefix = runtime?.downloadPrefix || 'Souhub-Image'
export const guideStorageKey = runtime?.guideStorageKey || 'souhub-studio-guide-v1'
export const siteConfig = {
  name: runtime?.name || import.meta.env.VITE_SITE_NAME || 'Souhub Image',
  mainOrigin: new URL(runtime?.mainOrigin || import.meta.env.VITE_MAIN_ORIGIN || 'https://souhub.top').origin,
}
