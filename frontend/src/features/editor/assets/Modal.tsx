import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import '../styles/assets.css'

interface ModalProps {
  label: string
  onClose: () => void
  wide?: boolean
  /** يظبط ‎data-asset-modal‎ عشان قواعد المكتبة (الكارت عمود والشبكة بس هي اللي بتتمرّر) */
  library?: boolean
  children: ReactNode
}

/**
 * نافذة المحرر (‎.ed-modal‎). بتترسم جوّه ‎.ed-root‎ (مش مكان استخدامها): متغيّرات الألوان
 * متعرّفة عليه، وعلى الموبايل اللوحة الجانبية ‎transform‎ فأي ‎position: fixed‎ جواها بيتحسب منها.
 */
export function Modal({ label, onClose, wide, library, children }: ModalProps) {
  const card = useRef<HTMLDivElement>(null)
  // آخر ‎onClose‎ من غير ما نعيد ربط المستمع (وإعادة التركيز) مع كل رسم
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // autoFocus جوّه النافذة (حقل الاسم) أسبق من التركيز على الكارت نفسه
    if (!card.current?.contains(document.activeElement)) card.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  const root = document.querySelector('.ed-root') ?? document.body
  return createPortal(
    <div
      className="ed-modal"
      {...(library ? { 'data-asset-modal': '' } : {})}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={card}
        tabIndex={-1}
        className={`ed-modal-card${wide ? ' ed-modal-card--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>,
    root,
  )
}
