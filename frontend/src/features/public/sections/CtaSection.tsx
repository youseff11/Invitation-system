import { useTranslation } from 'react-i18next'

import type { SiteInfo } from '@/api/types'
import { WhatsAppIcon } from '../icons'

/**
 * قسم «خطوتك التالية» — لوحة فخمة بلون أخضر زمردي من اللوجو: إطار دهبي مزدوج بأركان، نقشة
 * أرابيسك خفيفة، ولمعات صغيرة. زرار واتساب، أو إيميل لو مفيش واتساب، أو لا شيء.
 * كل الزخرفة ‎aria-hidden‎.
 */
export function CtaSection({ site }: { site: SiteInfo }) {
  const { t } = useTranslation()
  const label = t('public.cta.button')
  const wa = site.whatsapp.url
  return (
    <section className="section home-cta" id="contact">
      <div className="wrap home-cta-in cta-lux">
        <span className="cta-pattern" aria-hidden="true" />
        <span className="cta-corners" aria-hidden="true" />
        <span className="cta-spark cta-spark--a" aria-hidden="true" />
        <span className="cta-spark cta-spark--b" aria-hidden="true" />
        <span className="cta-spark cta-spark--c" aria-hidden="true" />
        <p className="eyebrow">{t('public.cta.eyebrow')}</p>
        <h2>{t('public.cta.title')}</h2>
        <p>{t('public.cta.sub')}</p>
        {wa ? (
          <>
            <a className="btn cta-btn btn--shine" href={wa} target="_blank" rel="noopener">
              <WhatsAppIcon className="cta-btn-icon" />
              <span>{label}</span>
            </a>
            <small className="cta-note">
              <i aria-hidden="true" />
              {t('public.whatsapp.status')}
            </small>
          </>
        ) : (
          site.email && (
            <a className="btn cta-btn btn--shine" href={`mailto:${site.email}`}>
              <span>{label}</span>
            </a>
          )
        )}
      </div>
    </section>
  )
}
