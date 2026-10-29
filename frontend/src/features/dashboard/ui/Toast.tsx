import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'

export type ToastKind = 'success' | 'error' | 'warning'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
  warning: (text: string) => void
  /** يعرض رسالة الخطأ القادمة من الـAPI (أو رسالة عامة لو الخطأ مش من السيرفر). */
  fail: (error: unknown) => void
}

const LIFETIME_MS: Record<ToastKind, number> = { success: 5000, warning: 9000, error: 9000 }
const MAX_VISIBLE = 4

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

/** تنبيهات اللوحة — بديل رسائل Django (‎messages‎). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      if (!text) return
      const id = nextId.current++
      setItems((current) => [...current, { id, kind, text }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS[kind]),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const live = timers.current
    return () => {
      for (const timer of live.values()) clearTimeout(timer)
      live.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      warning: (text) => push('warning', text),
      fail: (error) => push('error', errorText(error, t('errors.generic'), t('errors.network'))),
    }),
    [push, t],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="dash-toasts" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`dash-toast dash-toast--${item.kind}`}
            role={item.kind === 'error' ? 'alert' : 'status'}
          >
            <p>{item.text}</p>
            <button
              type="button"
              className="dash-toast-close"
              aria-label={t('dashboard.common.close')}
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function errorText(error: unknown, generic: string, network: string): string {
  if (error instanceof ApiError) return error.message || generic
  if (error instanceof TypeError) return network // fetch فشل قبل ما يوصل للسيرفر
  return generic
}
