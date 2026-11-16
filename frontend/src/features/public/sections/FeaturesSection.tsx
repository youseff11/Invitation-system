import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const FEATURES: { key: string; icon: ReactNode; className?: string }[] = [
  {
    key: 'countdown',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    key: 'gallery',
    icon: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m5 17 4.5-4 3 2.5 2-2 4.5 3.5" />
      </>
    ),
  },
  {
    key: 'rsvp',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8 12 2.5 2.5L16.5 9" />
      </>
    ),
  },
  {
    key: 'whatsapp',
    icon: (
      <>
        <path d="M20 4 4.5 10.2c-.8.3-.8 1.4 0 1.7l5.1 1.9 1.9 5.1c.3.8 1.4.8 1.7 0L20 4Z" />
        <path d="m9.7 13.8 4.2-4.2" />
      </>
    ),
  },
  {
    key: 'music',
    icon: (
      <>
        <path d="M9 18V6l10-2v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
      </>
    ),
  },
  {
    key: 'maps',
    icon: (
      <>
        <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2.3" />
      </>
    ),
  },
  {
    key: 'qr',
    icon: (
      <>
        <rect x="4" y="4" width="6" height="6" />
        <rect x="14" y="4" width="6" height="6" />
        <rect x="4" y="14" width="6" height="6" />
        <path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />
      </>
    ),
  },
  {
    key: 'calendar',
    icon: (
      <>
        <rect x="5" y="3.5" width="14" height="17" rx="2" />
        <path d="M9 7h6M9 11h6M9 15h3" />
      </>
    ),
  },
  {
    key: 'venueQr',
    className: 'feature-card--qr',
    icon: (
      <>
        <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4z" />
        <path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />
      </>
    ),
  },
]

export function FeaturesSection() {
  const { t } = useTranslation()
  return (
    <section className="section section--features" id="features">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.features.eyebrow')}</p>
          <h2>{t('public.features.title')}</h2>
          <p>{t('public.features.sub')}</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map(({ key, icon, className }) => (
            <article
              key={key}
              className={'feature-card' + (className ? ` ${className}` : '')}
              data-reveal
              data-reveal-stagger
            >
              <span className="feature-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {icon}
                </svg>
              </span>
              <h3>{t(`public.features.${key}.title`)}</h3>
              <p>{t(`public.features.${key}.text`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
