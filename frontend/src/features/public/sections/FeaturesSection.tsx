import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

/**
 * أيقونات المميزات. لما القسم يظهر خطوطها بتترسم (showcase.css)، وبعض
 * الأجزاء عليها كلاسات ‎fa-*‎ لحركة خفيفة جداً بالمرور بس.
 */
const FEATURES: { key: string; icon: ReactNode }[] = [
  {
    key: 'countdown',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path className="fa-hand" d="M12 12V6.5" />
        <path className="fa-hand-slow" d="M12 12h3.5" />
      </>
    ),
  },
  {
    key: 'gallery',
    icon: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <circle className="fa-sun" cx="8.5" cy="9" r="1.5" />
        <path className="fa-hills" d="m5 17 4.5-4 3 2.5 2-2 4.5 3.5" />
      </>
    ),
  },
  {
    key: 'rsvp',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path className="fa-check" d="m8 12 2.5 2.5L16.5 9" pathLength={1} />
      </>
    ),
  },
  {
    key: 'whatsapp',
    icon: (
      <g className="fa-plane">
        <path d="M20 4 4.5 10.2c-.8.3-.8 1.4 0 1.7l5.1 1.9 1.9 5.1c.3.8 1.4.8 1.7 0L20 4Z" />
        <path d="m9.7 13.8 4.2-4.2" />
      </g>
    ),
  },
  {
    key: 'music',
    icon: (
      <>
        <path d="M9 18V6l10-2v12" />
        <circle className="fa-note" cx="6" cy="18" r="3" />
        <circle className="fa-note fa-note--b" cx="16" cy="16" r="3" />
      </>
    ),
  },
  {
    key: 'maps',
    icon: (
      <>
        <ellipse className="fa-shadow" cx="12" cy="21" rx="3.5" ry=".8" />
        <g className="fa-pin">
          <path d="M12 19s6-5.3 6-10.3a6 6 0 1 0-12 0C6 13.7 12 19 12 19Z" />
          <circle cx="12" cy="8.7" r="2.1" />
        </g>
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
        <path className="fa-scan" d="M2.5 12h19" />
      </>
    ),
  },
  {
    key: 'calendar',
    icon: (
      <>
        <rect x="5" y="3.5" width="14" height="17" rx="2" />
        <path className="fa-line" d="M9 8h6" pathLength={1} />
        <path className="fa-line fa-line--b" d="M9 12h6" pathLength={1} />
        <path className="fa-line fa-line--c" d="M9 16h3" pathLength={1} />
      </>
    ),
  },
  {
    key: 'venueQr',
    icon: (
      <>
        <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4z" />
        <path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />
        <path className="fa-scan fa-scan--b" d="M2.5 12h19" />
      </>
    ),
  },
]

export function FeaturesSection() {
  const { t } = useTranslation()
  return (
    <section className="section feat-band" id="features">
      <div className="wrap feat-layout">
        {/* المقدمة ثابتة على الجنب وإنت بتنزل في القايمة (sticky) */}
        <div className="feat-intro" data-reveal>
          <p className="feat-eyebrow">{t('public.features.eyebrow')}</p>
          <h2>{t('public.features.title')}</h2>
          <p className="feat-sub">{t('public.features.sub')}</p>
          <Link className="btn btn--gold btn--lg btn--shine feat-cta" to="/templates">
            <span>{t('public.features.cta')}</span>
          </Link>
        </div>
        {/* شبكة مقسومة بخطوط دهبي رفيعة — الأيقونات بتترسم لما القسم يظهر */}
        <div className="feat-grid" data-reveal>
          {FEATURES.map(({ key, icon }, i) => (
            <article key={key} className="feat-item" style={{ '--i': i } as CSSProperties}>
              <span className="feat-icon">
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
