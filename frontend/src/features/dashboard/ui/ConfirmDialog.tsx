import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmOptions {
  message: string
  confirmLabel?: string
  /** يلوّن زرار التأكيد كإجراء خطر (حذف). */
  danger?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** بديل ‎window.confirm‎: ‎const confirm = useConfirm(); if (await confirm({ message })) …‎ */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  const confirm = useCallback<Confirm>((options) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }))
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
    if (!pending) return
    confirmButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, settle])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="dash-dialog-veil"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) settle(false)
          }}
        >
          <div className="dash-dialog dash-dialog--confirm" role="alertdialog" aria-modal="true" aria-label={pending.message}>
            <span className={`dash-dialog-icon${pending.danger ? ' is-danger' : ''}`} aria-hidden="true">
              {pending.danger ? '!' : '?'}
            </span>
            <p>{pending.message}</p>
            <div className="dash-dialog-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => settle(false)}>
                {t('dashboard.common.cancel')}
              </button>
              <button
                ref={confirmButton}
                type="button"
                className={`btn btn--sm ${pending.danger ? 'btn--ghost btn--danger' : 'btn--gold'}`}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? t('dashboard.common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
