import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { getPageScroller } from '../lib/pageScroll'

export function useStudioThreadScroll(conversationId: string | null, focusedTaskId: string | null, lastTaskId?: string) {
  const threadRef = useRef<HTMLElement>(null)
  const following = useRef(true)
  const anchor = useRef<string | null>(null)
  const align = useRef<() => void>(() => {})
  const [showJump, setShowJump] = useState(false)

  useLayoutEffect(() => {
    const scroller = getPageScroller()
    const page = 'scrollY' in scroller ? document.documentElement : scroller
    const viewportHeight = () => 'innerHeight' in scroller ? scroller.innerHeight : scroller.clientHeight
    const scrollTop = () => 'scrollY' in scroller ? scroller.scrollY : scroller.scrollTop
    const maximum = () => Math.max(0, page.scrollHeight - viewportHeight())
    const nearLatest = () => maximum() - scrollTop() <= 80
    let frame = 0
    anchor.current = focusedTaskId
    following.current = !focusedTaskId
    const settle = () => {
      if (anchor.current) {
        document.getElementById(`studio-turn-${anchor.current}`)?.scrollIntoView({ block: 'start', behavior: 'auto' })
      } else if (following.current) {
        scroller.scrollTo({ top: maximum(), behavior: 'auto' })
      }
      setShowJump(!nearLatest())
    }
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(settle)
    }
    align.current = schedule
    const onScroll = () => {
      const near = nearLatest()
      if (!anchor.current) following.current = near
      setShowJump(!near)
    }
    const stopFollowing = () => { anchor.current = null; following.current = false }
    const onKeyDown = (event: Event) => {
      const key = (event as KeyboardEvent).key
      if (!(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)) stopFollowing()
    }
    const onPointerDown = (event: Event) => { if (event.target === scroller) stopFollowing() }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', stopFollowing, { passive: true })
    scroller.addEventListener('touchmove', stopFollowing, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)
    scroller.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    if (threadRef.current) observer.observe(threadRef.current)
    // 输入栏和图片占位的高度在下一帧确定，后续尺寸变化仍维持当前阅读锚点。
    settle()
    schedule()
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', stopFollowing)
      scroller.removeEventListener('touchmove', stopFollowing)
      scroller.removeEventListener('keydown', onKeyDown)
      scroller.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', schedule)
      align.current = () => {}
    }
  }, [conversationId])

  useLayoutEffect(() => {
    if (focusedTaskId) {
      anchor.current = focusedTaskId
      following.current = false
    }
    align.current()
  }, [focusedTaskId, lastTaskId])

  const jumpToLatest = useCallback(() => {
    anchor.current = null
    following.current = true
    align.current()
  }, [])

  return { threadRef, showJump, jumpToLatest }
}
