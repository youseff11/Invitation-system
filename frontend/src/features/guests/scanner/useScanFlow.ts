import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'
import type { PassStatus, RsvpStatus, ScanData } from '../types'

export type ResultKind = 'ok' | 'warn' | 'bad'

export interface ScanResult {
  kind: ResultKind
  title: string
  lines: string[]
}

/** آخر كام اسم يظهروا في «آخر اللي دخلوا». */
const LOG_LIMIT = 12
/** نفس الكود قدام الكاميرا بيتقرا عشرات المرات في الثانية. */
const DEDUPE_MS = 2500

/** سبب رفض الدخلة، مبني على الأعداد (مش على نص السيرفر) عشان يتترجم. */
export function entryProblem(t: TFunction, used: number, allowed: number) {
  return allowed <= 0 ? t('guests.scan.noPass') : t('guests.scan.exhausted', { used, allowed })
}

export function describeScan(t: TFunction, d: ScanData): ScanResult {
  const meta: string[] = []
  if (d.code) meta.push(d.code)
  if (d.group) meta.push(d.group)
  if (d.rsvpStatus) meta.push(t('guests.scan.reply', { status: rsvpLabel(t, d.rsvpStatus) }))
  // العدّاد ده أهم حاجة على الباب: كام دخل من كام
  const count = t('guests.scan.count', { used: d.used, allowed: d.allowed, left: d.left })

  if (d.already) {
    return {
      kind: 'bad',
      title: `✕ ${d.name} — ${d.error ? entryProblem(t, d.used, d.allowed) : t('guests.scan.used')}`,
      lines: [count, meta.join(' · ')],
    }
  }
  const line = count + (d.left === 0 ? ` · ${t('guests.scan.complete')}` : '')
  return {
    kind: 'ok',
    title: `✓ ${d.name}`,
    lines: [line, meta.join(' · '), t('guests.scan.at', { time: d.at })],
  }
}

export function rsvpLabel(t: TFunction, status: RsvpStatus | '' | undefined) {
  return status ? t(`guests.rsvpStatus.${status}`) : ''
}

export function passLabel(t: TFunction, status: PassStatus) {
  return t(`guests.passStatus.${status}`)
}

function failureTitle(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_token') return t('guests.scan.invalidToken')
    if (error.code === 'guest_not_found') return t('guests.scan.notOurGuest')
    return error.message || t('guests.scan.failed')
  }
  return t('guests.scan.offline')
}

interface Options {
  scan: (token: string) => Promise<ScanData>
  /** بعد أي رد ناجح (حتى لو التصريح مستخدم) — بوابة القاعة بتعيد تحميل الكشف منه. */
  onScanned?: (data: ScanData) => void
}

/**
 * جلسة المسح: النتيجة الأخيرة، سجل اللي دخلوا، والعدّاد بعد آخر مسحة.
 * الكاميرا والإدخال اليدوي الاتنين بيمرّوا على ‎submit‎.
 */
export function useScanFlow({ scan, onScanned }: Options) {
  const { t } = useTranslation()
  const [result, setResult] = useState<ScanResult | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [counts, setCounts] = useState<{ arrived: number; total: number } | null>(null)
  const last = useRef({ token: '', at: 0 })
  const optionsRef = useRef({ scan, onScanned })
  useEffect(() => {
    optionsRef.current = { scan, onScanned }
  })

  const submit = useCallback(
    (token: string, manual = false) => {
      const now = Date.now()
      if (!manual && token === last.current.token && now - last.current.at < DEDUPE_MS) return
      // الإدخال اليدوي مايتمنعش بالتكرار
      last.current = { token: manual ? '' : token, at: now }

      optionsRef.current.scan(token).then(
        (d) => {
          const shown = describeScan(t, d)
          setResult(shown)
          if (!d.already) {
            const entry = `${d.at} — ${d.name}${d.allowed > 1 ? ` (${d.used}/${d.allowed})` : ''}`
            setLog((items) => [entry, ...items].slice(0, LOG_LIMIT))
          }
          setCounts({ arrived: d.arrived, total: d.total })
          optionsRef.current.onScanned?.(d)
        },
        (error: unknown) => {
          setResult({ kind: 'bad', title: `✕ ${failureTitle(t, error)}`, lines: [] })
        },
      )
    },
    [t],
  )

  const flash = useCallback((title: string, kind: ResultKind) => {
    setResult({ kind, title, lines: [] })
  }, [])

  return { result, log, counts, submit, flash }
}
