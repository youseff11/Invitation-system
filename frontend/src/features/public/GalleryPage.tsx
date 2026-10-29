import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { ApiError } from '@/api/client'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useGallery } from './hooks'
import { GalleryFooter } from './sections/SiteFooter'
import { GalleryTemplateCard } from './sections/TemplatesSection'
import { pick, useLang } from './text'

/** معرض القوالب بفلتر التصنيف (‎?category=‎). معاينة القالب نفسها صفحة تانية (B3). */
export function GalleryPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const [params] = useSearchParams()
  const category = params.get('category') ?? ''
  const { data: site } = useSite()
  const gallery = useGallery(category)

  useDocumentTitle(site ? t('public.title.gallery', { name: pick(lang, site.name.ar, site.name.en) }) : '')

  const results = gallery.data?.results
  return (
    <>
      <section className="section section--below-nav">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">{t('public.gallery.eyebrow')}</p>
            <h2>{t('public.gallery.title')}</h2>
          </div>
          <div className="toolbar toolbar--center">
            <Link className={'btn btn--sm ' + (category ? 'btn--ghost' : 'btn--gold')} to="/templates">
              {t('public.gallery.all')}
            </Link>
            {gallery.data?.categories.map(({ value, label }) => (
              <Link
                key={value}
                className={'btn btn--sm ' + (category === value ? 'btn--gold' : 'btn--ghost')}
                to={{ pathname: '/templates', search: `?category=${encodeURIComponent(value)}` }}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="grid grid--4">
            {results?.map((template) => <GalleryTemplateCard key={template.id} template={template} />)}
            {results?.length === 0 && <p className="empty">{t('public.gallery.empty')}</p>}
            {gallery.isError && (
              <p className="empty" role="alert">
                {gallery.error instanceof ApiError && gallery.error.message
                  ? gallery.error.message
                  : t('public.loadError')}
              </p>
            )}
          </div>
        </div>
      </section>
      <GalleryFooter site={site} />
    </>
  )
}
