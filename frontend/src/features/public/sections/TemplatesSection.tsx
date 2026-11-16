import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { firstChar, pick, truncateChars, useLang } from '../text'
import type { PublicTemplate } from '../types'

const previewPath = (template: PublicTemplate) => `/templates/${template.slug}/preview/`

/** الغلاف: صورة لو فيه، وإلا أول حرف من الاسم. ‎JSON.stringify‎ بيهرّب أي علامة اقتباس في الرابط. */
function Cover({ template, name }: { template: PublicTemplate; name: string }) {
  return (
    <div
      className="tpl-cover"
      style={template.cover ? { backgroundImage: `url(${JSON.stringify(template.cover)})` } : undefined}
    >
      {!template.cover && firstChar(name)}
    </div>
  )
}

/**
 * الغلاف جوّه «برواز»: حافة عاجي رفيعة بخط دهبي زي لوحة متبروزة. البرواز كله لينك للمعاينة
 * (الضغط على صورة القالب بيفتحه)، وبالمرور الصورة بتقرّب بالراحة ويظهر عليها اسم الفعل.
 */
function Frame({ template, name, label }: { template: PublicTemplate; name: string; label: string }) {
  return (
    <Link className="tpl-frame" to={previewPath(template)} aria-label={`${label} — ${name}`}>
      <Cover template={template} name={name} />
      <span className="tpl-frame-cta" aria-hidden="true">
        {label}
      </span>
    </Link>
  )
}

/** سهم صغير بيلف مع اتجاه القراية (الـCSS بيقلبه في العربي) */
function Arrow() {
  return (
    <svg className="tpl-link-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h13m0 0-5-5m5 5-5 5" />
    </svg>
  )
}

function Meta({ template }: { template: PublicTemplate }) {
  // «بدون» تصنيف ومن غير مجموعة = مفيش سطر خالص تحت الاسم
  if (template.category === 'none' && !template.collection) return null
  return (
    <span className="tpl-meta">
      {template.category !== 'none' && (
        <>
          {template.categoryLabel}
          {template.collection && ' · '}
        </>
      )}
      {template.collection}
    </span>
  )
}

/** كارت القالب في الرئيسية: برواز الغلاف، التصنيف والاسم، ولينك «تجربة قالب». */
export function HomeTemplateCard({ template }: { template: PublicTemplate }) {
  const { t } = useTranslation()
  const lang = useLang()
  const name = pick(lang, template.name, template.nameEn)
  const hasDescription = !!(template.description || template.descriptionEn)
  const label = t('public.templates.preview')
  return (
    <article className="tpl-card tpl-card--frame">
      <Frame template={template} name={name} label={label} />
      <div className="tpl-body">
        <Meta template={template} />
        <h3>{name}</h3>
        {hasDescription && <p className="tpl-desc">{pick(lang, template.description, template.descriptionEn)}</p>}
        <div className="tpl-actions">
          <Link className="tpl-link" to={previewPath(template)}>
            <span>{label}</span>
            <Arrow />
          </Link>
        </div>
      </div>
    </article>
  )
}

/** كارت القالب في معرض القوالب: نفس البرواز + معاينة حية و«اطلبه». */
export function GalleryTemplateCard({ template }: { template: PublicTemplate }) {
  const { t } = useTranslation()
  const lang = useLang()
  const name = pick(lang, template.name, template.nameEn)
  const hasDescription = !!(template.description || template.descriptionEn)
  return (
    <article className="tpl-card tpl-card--frame">
      <Frame template={template} name={name} label={t('public.gallery.live')} />
      <div className="tpl-body">
        <Meta template={template} />
        <h3>{name}</h3>
        {hasDescription && (
          <p className="muted tpl-desc--sm">
            {pick(lang, truncateChars(template.description, 80), truncateChars(template.descriptionEn, 80))}
          </p>
        )}
        <div className="tpl-actions">
          <Link className="btn btn--ghost btn--sm" to={previewPath(template)}>
            {t('public.gallery.live')}
          </Link>
          <Link className="btn btn--gold btn--sm" to={{ pathname: '/', hash: '#order' }}>
            {t('public.gallery.order')}
          </Link>
        </div>
      </div>
    </article>
  )
}

interface Props {
  templates: PublicTemplate[] | undefined
  error: unknown
  /** عدد القوالب في الصف على التليفون — من إعدادات الموقع (الافتراضي واحد) */
  perRow?: 1 | 2
}

export function TemplatesSection({ templates, error, perRow = 1 }: Props) {
  const { t } = useTranslation()
  return (
    <section className="section" id="templates">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">{t('public.templates.eyebrow')}</p>
          <h2>{t('public.templates.title')}</h2>
          <p>{t('public.templates.sub')}</p>
        </div>
        <div className="grid grid--4" data-per-row={perRow}>
          {templates?.map((template) => <HomeTemplateCard key={template.id} template={template} />)}
          {templates?.length === 0 && <p className="empty">{t('public.templates.empty')}</p>}
          {!!error && (
            <p className="empty" role="alert">
              {error instanceof ApiError && error.message ? error.message : t('public.loadError')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
