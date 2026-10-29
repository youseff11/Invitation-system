import { useTranslation } from 'react-i18next'

import type { Lang } from '@/api/types'

/** لغة الواجهة الحالية. */
export function useLang(): Lang {
  const { i18n } = useTranslation()
  return i18n.language === 'en' ? 'en' : 'ar'
}

/**
 * النسخة الإنجليزية لو لغة الواجهة إنجليزي والعمود مش فاضي، وإلا العربي —
 * نفس احتياطي ‎_pick‎ في models.py ووسم ‎bidb‎ في الموقع القديم.
 */
export function pick(lang: Lang, ar: string, en: string): string {
  return lang === 'en' && en.trim() ? en : ar
}

/** نفس ‎truncatechars‎ في Django: الطول الكلي يشمل علامة الحذف. */
export function truncateChars(text: string, length: number): string {
  const chars = Array.from(text)
  if (chars.length <= length) return text
  return chars.slice(0, Math.max(length - 1, 0)).join('') + '…'
}

/** أول حرف من الاسم (للغلاف لما مفيش صورة). */
export function firstChar(text: string): string {
  return Array.from(text)[0] ?? ''
}
