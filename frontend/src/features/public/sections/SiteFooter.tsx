import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { SiteInfo } from '@/api/types'
import { WhatsAppIcon } from '../icons'
import { pick, useLang } from '../text'

/** فوتر الرئيسية: اللوجو + الاسم والشعار + روابط التواصل المفعّلة من إعدادات الموقع. */
export function HomeFooter({ site }: { site: SiteInfo }) {
  const { t } = useTranslation()
  const lang = useLang()
  const name = pick(lang, site.name.ar, site.name.en)
  return (
    <footer className="foot">
      <div className="wrap foot-inner">
        <Link className="foot-brand" to="/" aria-label={name}>
          <img src="/static/images/logo.jpeg" alt={name} />
        </Link>
        <p>
          {name} — {pick(lang, site.tagline.ar, site.tagline.en)}
        </p>
        <div className="foot-socials" aria-label={t('public.footer.social')}>
          {site.whatsapp.url && (
            <a href={site.whatsapp.url} target="_blank" rel="noopener" aria-label="WhatsApp">
              <WhatsAppIcon className="wa-icon" />
            </a>
          )}
          {site.facebookUrl && (
            <a href={site.facebookUrl} target="_blank" rel="noopener" aria-label="Facebook">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H6v4h3v5h4v-5h3l1-4h-4V9c0-.6.4-1 1-1Z" />
              </svg>
            </a>
          )}
          {site.instagramUrl && (
            <a href={site.instagramUrl} target="_blank" rel="noopener" aria-label="Instagram">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="4" />
                <circle cx="12" cy="12" r="3.5" />
                <circle cx="17.5" cy="6.8" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}

/** فوتر معرض القوالب: اسم الموقع بس. */
export function GalleryFooter({ site }: { site: SiteInfo | undefined }) {
  const lang = useLang()
  return (
    <footer className="foot">
      <div className="wrap">{site && pick(lang, site.name.ar, site.name.en)}</div>
    </footer>
  )
}
