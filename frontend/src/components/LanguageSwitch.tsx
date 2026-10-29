import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import type { Lang } from '@/api/types'
import { applyDocumentLanguage } from '@/i18n'
import { prefersReducedMotion } from '@/features/public/motion'

/** مفتاح اللغة اللي الموقع القديم بيحفظه في المتصفح (صفحاته ثنائية اللغة بتقراه). */
const LEGACY_KEY = 'farha-lang'

/**
 * تبديل اللغة فوري زي الموقع القديم: المحتوى اللي جاي من الـAPI فيه اللغتين،
 * فمفيش انتظار للسيرفر — بنبدّل لغة الواجهة و‎<html lang dir>‎ على طول (بانتقال
 * ناعم لو المتصفح بيدعم ومفيش «تقليل حركة»)، والسيرفر بيتبلّغ في الخلفية
 * عشان أي صفحة تتفتح بعد كده تجي باللغة الصح.
 */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation()
  const next: Lang = i18n.language === 'ar' ? 'en' : 'ar'

  function switchLanguage() {
    const swap = () =>
      flushSync(() => {
        void i18n.changeLanguage(next)
        applyDocumentLanguage(next)
      })
    if (document.startViewTransition && !prefersReducedMotion()) document.startViewTransition(swap)
    else swap()

    try {
      localStorage.setItem(LEGACY_KEY, next)
    } catch {
      /* تخزين ممنوع */
    }
    api('/language/', { method: 'POST', body: { language: next } }).catch(() => {})
  }

  const label = t('public.nav.switchLanguage')
  return (
    <button className="lang-btn" type="button" onClick={switchLanguage} title={label} aria-label={label}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 9.2h17M3.5 14.8h17" />
        <path d="M12 3c2.6 2.5 4 5.5 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.5-4-9s1.4-6.5 4-9Z" />
      </svg>
      {/* الحرف اللي على الزرار: بيوري اللغة اللي هتروح لها */}
      <span>{t('public.nav.switchLanguageShort')}</span>
    </button>
  )
}
