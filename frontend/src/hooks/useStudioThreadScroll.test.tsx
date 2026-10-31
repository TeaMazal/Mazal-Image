// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudioThreadScroll } from './useStudioThreadScroll'

const page = vi.hoisted(() => ({ scroller: null as HTMLElement | null }))
vi.mock('../lib/pageScroll', () => ({ getPageScroller: () => page.scroller || window }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let height: number
let frames: Map<number, FrameRequestCallback>
let resize: () => void
let frameId: number
let props: { conversation: string; focused: string | null; last: string }
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

function Thread() {
  const { threadRef, showJump, jumpToLatest } = useStudioThreadScroll(props.conversation, props.focused, props.last)
  return <section ref={threadRef}><article id="studio-turn-old">原轮次</article>{showJump && <button onClick={jumpToLatest}>跳到最新</button>}</section>
}
function flush() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(0))
}
function render() { act(() => { root.render(<Thread />); flush() }) }
function resizeContent(nextHeight: number) { act(() => { height = nextHeight; resize(); flush() }) }

beforeEach(() => {
  height = 3000
  frames = new Map()
  frameId = 0
  props = { conversation: 'a', focused: null, last: 'last-a' }
  container = document.createElement('div')
  document.body.appendChild(container)
  page.scroller = container
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 800 })
  container.scrollTo = vi.fn((options: ScrollToOptions) => { container.scrollTop = Math.min(height - 800, Number(options.top)); container.dispatchEvent(new Event('scroll')) }) as typeof container.scrollTo
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn(() => { container.scrollTop = 200; container.dispatchEvent(new Event('scroll')) }) })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  page.scroller = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('studio conversation scroll', () => {
  it('opens each conversation at its latest round and follows late layout changes', () => {
    render()
    expect(container.scrollTop).toBe(2200)
    expect(container.querySelector('button')).toBeNull()
    resizeContent(3800)
    expect(container.scrollTop).toBe(3000)
    act(() => { container.dispatchEvent(new WheelEvent('wheel')); container.scrollTop = 600; container.dispatchEvent(new Event('scroll')) })
    props = { ...props, conversation: 'b', last: 'last-b' }
    render()
    expect(container.scrollTop).toBe(3000)
    resizeContent(4100)
    expect(container.scrollTop).toBe(3300)
  })

  it('does not pull a reader away from history when an image finishes', () => {
    render()
    act(() => { container.dispatchEvent(new WheelEvent('wheel')); container.scrollTop = 500; container.dispatchEvent(new Event('scroll')) })
    resizeContent(3800)
    expect(container.scrollTop).toBe(500)
    expect(container.querySelector('button')?.textContent).toBe('跳到最新')
    props = { ...props, last: 'new-result' }
    render()
    expect(container.scrollTop).toBe(500)
  })

  it('returns to the end on request and resumes following new results', () => {
    render()
    act(() => { container.scrollTop = 500; container.dispatchEvent(new Event('scroll')) })
    act(() => { container.querySelector('button')!.click(); flush() })
    expect(container.scrollTop).toBe(2200)
    expect(container.querySelector('button')).toBeNull()
    resizeContent(4200)
    expect(container.scrollTop).toBe(3400)
  })

  it('keeps an explicitly requested gallery round in view through late layout changes', () => {
    props.focused = 'old'
    render()
    expect(container.scrollTop).toBe(200)
    props.focused = null
    render()
    resizeContent(4000)
    expect(container.scrollTop).toBe(200)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    act(() => { container.dispatchEvent(new WheelEvent('wheel')); container.scrollTop = 600; container.dispatchEvent(new Event('scroll')) })
    resizeContent(4500)
    expect(container.scrollTop).toBe(600)
  })

  it('cancels pending layout work when the thread unmounts', () => {
    render()
    act(() => resize())
    expect(frames.size).toBeGreaterThan(0)
    act(() => root.unmount())
    expect(frames.size).toBe(0)
    root = createRoot(container)
  })

  it('also uses the window scroll range on browsers with floating scrollbars', () => {
    page.scroller = null
    const previous = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight')
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: height - window.innerHeight, behavior: 'auto' })
    if (previous) Object.defineProperty(document.documentElement, 'scrollHeight', previous)
    else Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  })
})
