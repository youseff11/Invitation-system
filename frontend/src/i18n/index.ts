import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import type { Lang } from '@/api/types'

export const DIRECTION: Record<Lang, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr' }

type Messages = Record<string, unknown>

/**
 * كل لغة مقسّمة لملفات في ‎locales/<lang>/‎ — كل ميزة (public، dashboard، guests،
 * invite) ليها ملفها فمفيش جلستين بيعدّلوا نفس الملف.
 *  - ‎core.json‎: بيتفرد على الجذر (‎t('nav.home')‎).
 *  - أي ملف تاني بيتحط تحت اسمه (‎public.json‎ → ‎t('public.hero.title')‎).
 */
function loadLocale(files: Record<string, { default: Messages }>): Messages {
  const merged: Messages = {}
  for (const [path, module] of Object.entries(files)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '')
    if (name === 'core') Object.assign(merged, module.default)
    else merged[name] = module.default
  }
  return merged
}

export const resources = {
  ar: {
    translation: loadLocale(
      import.meta.glob<{ default: Messages }>('./locales/ar/*.json', { eager: true }),
    ),
  },
  en: {
    translation: loadLocale(
      import.meta.glob<{ default: Messages }>('./locales/en/*.json', { eager: true }),
    ),
  },
}

/** يضبط lang/dir على <html> — الـCSS (خطوط وتباعد) بيعتمد عليهم. */
export function applyDocumentLanguage(lang: Lang) {
  document.documentElement.lang = lang
  document.documentElement.dir = DIRECTION[lang]
}

export function initI18n(lang: Lang) {
  void i18n.use(initReactI18next).init({
    lng: lang,
    fallbackLng: 'ar',
    resources,
    interpolation: { escapeValue: false }, // React بيهرّب لوحده
    returnNull: false,
  })
  applyDocumentLanguage(lang)
  return i18n
}

export default i18n
