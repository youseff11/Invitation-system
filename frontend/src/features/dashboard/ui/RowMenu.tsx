import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** تحت العرض ده القائمة بتبقى شيت من تحت (مطابق لـ‎SHEET_AT‎ في site.js القديم). */
const SHEET_AT = 560
const COPY_FEEDBACK_MS = 1600
const CLOSE_AFTER_COPY_MS = 1100

interface RowMenuProps {
  label: ReactNode
  children: ReactNode
}

/**
 * قائمة روابط الصف. القائمة ‎position: fixed‎ ومكانها بيتحسب بالجافاسكربت: جدول اللوحة
 * جوه حاوية بتمرير أفقي، وأي قائمة ‎absolute‎ جواها بتتقص عند حافة الحاوية.
 */
export function RowMenu({ label, children }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popId = useId()

  const close = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(false)
  }, [])

  const closeSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(close, CLOSE_AFTER_COPY_MS)
  }, [close])

  // مكان القائمة: تحت الزرار لو فيه مكان، وفوقه لو الصفحة خلصت؛ محاذاة لحافة الزرار
  useLayoutEffect(() => {
    const el = pop.current
    const btn = button.current
    if (!open || !el || !btn) return
    const isSheet = window.innerWidth <= SHEET_AT
    setSheet(isSheet)
    if (isSheet) {
      Object.assign(el.style, { top: 'auto', left: '12px', right: '12px', bottom: '12px' })
      return
    }
    el.style.right = ''
    el.style.bottom = ''
    const rect = btn.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const gap = 6
    const edge = 10
    let top = rect.bottom + gap
    if (top + height > window.innerHeight - edge) top = Math.max(edge, rect.top - height - gap)
    let left = rect.right - width
    if (left + width > window.innerWidth - edge) left = window.innerWidth - edge - width
    if (left < edge) left = edge
    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocumentClick = (event: Event) => {
      const target = event.target as Node
      if (pop.current?.contains(target) || button.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') close()
    }
    const onScroll = () => {
      if (window.innerWidth > SHEET_AT) close()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    // capture عشان نلتقط تمرير الحاوية نفسها مش الصفحة بس
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close])

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  function onPopClick(event: MouseEvent) {
    // ضغطة نسخ: نسيب القائمة لحظة عشان المستخدم يشوف «✓ اتنسخ»
    if ((event.target as HTMLElement).closest('[data-copy]')) closeSoon()
    else close()
  }

  return (
    <>
      <div className="rowmenu">
        <button
          ref={button}
          className="btn btn--ghost btn--sm rowmenu-btn"
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          aria-controls={popId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {label} <span className="rowmenu-caret" aria-hidden="true">▾</span>
        </button>
        <div
          ref={pop}
          id={popId}
          className={sheet && open ? 'rowmenu-pop is-sheet' : 'rowmenu-pop'}
          hidden={!open}
          onClick={onPopClick}
        >
          {children}
        </div>
      </div>
      {open && sheet && <div className="rowmenu-veil" />}
    </>
  )
}

export function RowMenuTitle({ children }: { children: ReactNode }) {
  return <p className="rowmenu-title">{children}</p>
}

export function RowMenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="rowmenu-item" href={href} target="_blank" rel="noopener">
      <span>{children}</span>
      <i className="rowmenu-ico" aria-hidden="true">↗</i>
    </a>
  )
}

export function RowMenuButton({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={danger ? 'rowmenu-item rowmenu-item--danger' : 'rowmenu-item'}
      onClick={onClick}
    >
      <span>{children}</span>
      <i className="rowmenu-ico" aria-hidden="true">{icon}</i>
    </button>
  )
}

/** نسخ نص للحافظة؛ لو المتصفح مانع الحافظة بنطلع ‎prompt‎ يدوي (زي القديم). */
export async function copyText(text: string, fallbackPrompt: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt(fallbackPrompt, text)
    return false
  }
}

export function RowMenuCopy({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function onClick() {
    if (!(await copyText(text, t('dashboard.invitations.copyPrompt')))) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }

  return (
    <button type="button" className="rowmenu-item" data-copy={text} onClick={() => void onClick()}>
      <span>{copied ? t('dashboard.invitations.copied') : children}</span>
      <i className="rowmenu-ico" aria-hidden="true">⧉</i>
    </button>
  )
}
