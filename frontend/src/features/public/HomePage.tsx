import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { FxSky } from './fx'
import { usePublicHome } from './hooks'
import { CtaSection } from './sections/CtaSection'
import { FaqSection } from './sections/FaqSection'
import { FeaturesSection } from './sections/FeaturesSection'
import { HeroSection } from './sections/HeroSection'
import { OrderSection } from './sections/OrderSection'
import { PlansSection } from './sections/PlansSection'
import { HomeFooter } from './sections/SiteFooter'
import { StepsSection } from './sections/StepsSection'
import { TemplatesSection } from './sections/TemplatesSection'
import { pick, useLang } from './text'
import { useReveal } from './useReveal'

/**
 * نموذج «اطلب دعوتك» في الرئيسية.
 * في الموقع القديم (templates/public/home.html) القسم متعلّق بتعليق HTML
 * («قسم الطلب القديم مستبدل بزر التواصل الموحد أسفل الصفحة») — فمابيظهرش حتى
 * لو الطلبات مفعّلة، والزوّار بيتوجّهوا لواتساب/قسم التواصل. الـAPI
 * (‎POST /api/v1/orders/‎) والنموذج جاهزين؛ اقلب القيمة دي لـ‎true‎ لو عايز
 * النموذج يرجع يظهر لما ‎ordersEnabled‎ يبقى مفعّل.
 */
const SHOW_ORDER_FORM = false

/** لما الرابط فيه ‎#plans‎ مثلاً: ننزل للقسم لما يتعرض (ولما البيانات توصل). */
function useHashScroll(ready: boolean) {
  const { hash, key } = useLocation()
  useEffect(() => {
    if (!ready || !hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
  }, [ready, hash, key])
}

/** الصفحة الرئيسية للموقع العام: الهيرو، القوالب، المميزات، الباقات، الخطوات، الأسئلة، التواصل. */
export function HomePage() {
  const { t } = useTranslation()
  const lang = useLang()
  const { data: site } = useSite()
  const home = usePublicHome()

  useReveal()
  useHashScroll(!!home.data)
  useDocumentTitle(site ? t('public.title.home', { name: pick(lang, site.name.ar, site.name.en) }) : '')

  // الإعدادات (مفاتيح الإظهار) جاية مع الصفحة نفسها فالهيكل بيتعرض قبل البيانات
  if (!site) return null

  return (
    <>
      <FxSky />
      <HeroSection plansPublic={site.plansPublic} hero={site.hero} />
      <TemplatesSection templates={home.data?.templates} error={home.error} perRow={site.templatesPerRow} />
      <FeaturesSection />
      {site.plansPublic && <PlansSection site={site} plans={home.data?.plans} />}
      <StepsSection />
      {SHOW_ORDER_FORM && site.ordersEnabled && <OrderSection site={site} />}
      <FaqSection faqs={home.data?.faqs} />
      <CtaSection site={site} />
      <HomeFooter site={site} />
    </>
  )
}
