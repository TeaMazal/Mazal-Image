export interface MazalBalance {
  source: string
  balance: number | null
  remaining: number | null
  quota: { limit: number | null; used: number | null; remaining: number | null } | null
  rate_limits: Array<{ window: string; remaining: number | null }>
  subscription: boolean
}

export interface MazalSession {
  subject_id: string
  role: 'user' | 'admin'
  balance: MazalBalance
  models: string[]
  notice: string
}

export const MAZAL_PROVIDER = 'custom-mazal'
export const MAZAL_PROFILE = 'mazal-image'
const KEY_STORAGE = 'mazal-image-key'
let session: MazalSession | null = null
let embeddedKey = ''
export const isMazalEmbedded = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('embed') === 'mazal' && window.parent !== window

export function getMazalKey() {
  if (isMazalEmbedded) return embeddedKey
  return sessionStorage.getItem(KEY_STORAGE) || localStorage.getItem(KEY_STORAGE) || ''
}

export function saveMazalSession(key: string, value: MazalSession, remember: boolean) {
  session = value
  if (isMazalEmbedded) {
    embeddedKey = key
    return
  }
  sessionStorage.setItem(KEY_STORAGE, key)
  if (remember) localStorage.setItem(KEY_STORAGE, key)
  else localStorage.removeItem(KEY_STORAGE)
}

export function getMazalSession() {
  return session
}

export function mazalStorageName() {
  return session ? `mazal-image-${session.subject_id}` : 'gpt-image-playground'
}

export function logoutMazal() {
  sessionStorage.removeItem(KEY_STORAGE)
  localStorage.removeItem(KEY_STORAGE)
  window.location.replace('/')
}

export async function mazalRequest<T>(path: string, init: RequestInit = {}, key = getMazalKey()): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { ...init.headers, Authorization: `Bearer ${key}` },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  }).catch((err) => {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new Error('连接超时，请稍后重试')
    throw err
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body?.detail?.error ?? body?.error?.message ?? body?.detail ?? body?.message
    throw new Error(typeof error === 'string' ? error : `请求失败（${response.status}），请稍后重试`)
  }
  return body as T
}
