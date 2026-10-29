import { useTranslation } from 'react-i18next'

import type { SiteInfo } from '@/api/types'

/** قسم «خطوتك التالية»: زرار واتساب، أو إيميل لو مفيش واتساب، أو لا شيء. */
export function CtaSection({ site }: { site: SiteInfo }) {
  const { t } = useTranslation()
  const label = t('public.cta.button')
  return (
    <section className="section home-cta" id="contact">
      <div className="wrap home-cta-in" data-reveal>
        <p className="eyebrow">{t('public.cta.eyebrow')}</p>
        <h2>{t('public.cta.title')}</h2>
        <p>{t('public.cta.sub')}</p>
        {site.whatsapp.url ? (
          <a className="btn btn--gold" href={site.whatsapp.url} target="_blank" rel="noopener">
            {label}
          </a>
        ) : (
          site.email && (
            <a className="btn btn--gold" href={`mailto:${site.email}`}>
              {label}
            </a>
          )
        )}
      </div>
    </section>
  )
}
