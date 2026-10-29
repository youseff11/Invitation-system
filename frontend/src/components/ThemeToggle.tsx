import { useTranslation } from 'react-i18next'

import { warmOtherVariants } from '@/features/public/warm'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { t } = useTranslation()
  const toggle = useTheme((s) => s.toggle)

  function onToggle() {
    toggle()
    // «التاني» بقى العكس — سخّنه للضغطة الجاية
    warmOtherVariants()
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onToggle}
      // لو الزائر قرّب من الزرار قبل ما وقت الفراغ ييجي، نسخّن على طول
      onPointerEnter={warmOtherVariants}
      aria-label={t('public.nav.theme')}
    >
      <svg
        className="i-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
      </svg>
      <svg
        className="i-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.9 6.9 0 0 0 10.8 10.8Z" />
      </svg>
    </button>
  )
}
