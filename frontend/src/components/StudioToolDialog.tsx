import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

export default function StudioToolDialog({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, close)
  usePreventBackgroundScroll(true, panel)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="studio studio-tool-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div ref={panel} className={`studio-tool-dialog${wide ? ' studio-tool-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
      if (!elements.length) { event.preventDefault(); panel.current?.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }}>
      <header className="studio-tool-heading"><h2>{title}</h2><button onClick={close} aria-label="关闭">×</button></header>
      {children}
    </div>
  </div>, document.body)
}
