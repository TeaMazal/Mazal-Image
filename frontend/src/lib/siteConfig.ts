declare global {
  interface Window {
    __MAZAL_IMAGE_CONFIG__?: { name: string; mainOrigin: string }
  }
}

const runtime = typeof window !== 'undefined' ? window.__MAZAL_IMAGE_CONFIG__ : undefined
export const siteConfig = {
  name: runtime?.name || import.meta.env.VITE_SITE_NAME || 'Mazal Image',
  mainOrigin: new URL(runtime?.mainOrigin || import.meta.env.VITE_MAIN_ORIGIN || 'http://localhost:8080').origin,
}
