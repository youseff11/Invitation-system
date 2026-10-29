import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export type ToastKind = 'ok' | 'error' | 'info'

export interface ConfirmOptions {
  confirmLabel?: string
  /** يلوّن زرار التأكيد كإجراء خطر (حذف/مسح). */
  danger?: boolean
}

interface Ui {
  toast: (text: string, kind?: ToastKind) => void
  /** بديل ‎window.confirm‎: ‎if (await ui.confirm(text, { danger: true })) …‎ */
  confirm: (text: string, options?: ConfirmOptions) => Promise<boolean>
}

const UiContext = createContext<Ui | null>(null)

export function useEditorUi(): Ui {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useEditorUi must be used inside <EditorUiProvider>')
  return ui
}

interface Item {
  id: number
  text: string
  kind: ToastKind
}

interface Pending extends ConfirmOptions {
  text: string
  resolve: (ok: boolean) => void
}

/** تنبيهات المحرر (‎.ed-toasts‎) وحوار التأكيد — لوحدهم عشان المحرر ملوش علاقة بغلاف لوحة التحكم وCSS بتاعه. */
export function EditorUiProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<Item[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const next = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const okButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    if (!text) return
    const id = next.current++
    setItems((current) => [...current, { id, text, kind }].slice(-4))
    const timer = setTimeout(
      () => {
        timers.current.delete(timer)
        setItems((current) => current.filter((item) => item.id !== id))
      },
      kind === 'error' ? 5200 : 2800,
    )
    timers.current.add(timer)
  }, [])

  const confirm = useCallback((text: string, options: ConfirmOptions = {}) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return new Promise<boolean>((resolve) => setPending({ ...options, text, resolve }))
  }, [])

  const settle = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok)
      setPending(null)
      opener.current?.focus?.()
    },
    [pending],
  )

  useEffect(() => {
    const live = timers.current
    return () => live.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (!pending) return
    okButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // المحرر عنده اختصارات على Esc (إغلاق اللوحات): الحوار هو اللي ياخدها وهو مفتوح
      event.stopPropagation()
      settle(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pending, settle])

  const ui = useMemo<Ui>(() => ({ toast, confirm }), [toast, confirm])

  // متغيّرات --e-* متعرّفة على ‎.ed-root‎ بس: من غيرها الحوار والتنبيهات بيطلعوا من غير ألوان
  const layer = (
    <>
      <div className="ed-toasts" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`ed-toast${item.kind === 'info' ? '' : ` ed-toast--${item.kind}`}`} role={item.kind === 'error' ? 'alert' : 'status'}>
            {item.text}
          </div>
        ))}
      </div>
      {pending && (
        <div
          className="ed-modal ed-confirm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) settle(false)
          }}
        >
          <div className="ed-modal-card ed-confirm-card" role="alertdialog" aria-modal="true" aria-label={pending.text}>
            <span className={`ed-confirm-icon${pending.danger ? ' is-danger' : ''}`} aria-hidden="true">
              {pending.danger ? '!' : '?'}
            </span>
            <p className="ed-confirm-text">{pending.text}</p>
            <div className="ed-modal-actions">
              <button type="button" className="ed-btn" onClick={() => settle(false)}>
                {t('editor.confirm.cancel')}
              </button>
              <button
                ref={okButton}
                type="button"
                className={`ed-btn ${pending.danger ? 'ed-btn--danger-solid' : 'ed-btn--primary'}`}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? t(pending.danger ? 'editor.confirm.delete' : 'editor.confirm.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <UiContext.Provider value={ui}>
      {children}
      {createPortal(layer, document.querySelector('.ed-root') ?? document.body)}
    </UiContext.Provider>
  )
}
