import { useTranslation } from 'react-i18next'

import type { SiteInfo } from '@/api/types'
import { WhatsAppIcon } from '../icons'

/**
 * قسم «خطوتك التالية» — لوحة على شكل قوس (زي بوابة) بألوان الموقع: عاجي ودهبي. قوس داخلي
 * رفيع، ختم شمع دهبي بحلقتين متشابكتين على قمّة القوس، أركان تحت، وفاصل دهبي تحت العنوان.
 * زرار واتساب، أو إيميل لو مفيش واتساب، أو لا شيء. كل الزخرفة ‎aria-hidden‎.
 */
export function CtaSection({ site }: { site: SiteInfo }) {
  const { t } = useTranslation()
  const label = t('public.cta.button')
  const wa = site.whatsapp.url
  return (
    <section className="section home-cta" id="contact">
      <div className="wrap home-cta-in cta-arch">
        <span className="cta-corners" aria-hidden="true" />
        <span className="cta-spark cta-spark--a" aria-hidden="true" />
        <span className="cta-spark cta-spark--b" aria-hidden="true" />
        <span className="cta-spark cta-spark--c" aria-hidden="true" />
        <span className="cta-seal" aria-hidden="true">
          <svg viewBox="4 3 24 24" focusable="false">
            <circle cx="12.5" cy="17" r="6.5" />
            <circle cx="19.5" cy="17" r="6.5" />
            <path d="M16 5.5c.6 1.9 1.6 2.9 3.5 3.5-1.9.6-2.9 1.6-3.5 3.5-.6-1.9-1.6-2.9-3.5-3.5 1.9-.6 2.9-1.6 3.5-3.5Z" />
          </svg>
        </span>
        <p className="eyebrow">{t('public.cta.eyebrow')}</p>
        <h2>{t('public.cta.title')}</h2>
        <span className="cta-rule" aria-hidden="true" />
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
