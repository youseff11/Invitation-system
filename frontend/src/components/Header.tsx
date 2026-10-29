import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useMe, useSite } from '@/api/hooks'
import { pick, useLang } from '@/features/public/text'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'

/** النزول (بالبكسل) اللي بعده الترويسة بتتقلّص، والرجوع اللي تحته بتكبر تاني. */
const STUCK_ON = 24
const STUCK_OFF = 4

/** عرض الشاشة اللي بعده القايمة بتتحوّل من برجر لصف أفقي (نفس ‎site.js‎). */
const DESKTOP_MIN = 900

/** بيرجّع ‎true‎ بعد ما الصفحة تنزل شوية — الجزيرة بتتقلّص وتاخد ظل (‎is-stuck‎). */
function useStuck(): boolean {
  const [stuck, setStuck] = useState(() => window.scrollY > STUCK_ON)
  useEffect(() => {
    let ticking = false
    const update = () => {
      ticking = false
      // عتبتين مختلفتين (تشغيل ≠ إيقاف): من غير كده التذبذب حوالين نقطة واحدة بيرعّش الترويسة
      setStuck((was) => (was ? window.scrollY > STUCK_OFF : window.scrollY > STUCK_ON))
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return stuck
}

/**
 * القسم الحالي في الرئيسية فقط (scroll-spy): آخر قسم بدايته فوق خط القياس
 * تحت الترويسة، ولو وصلنا آخر الصفحة بنوّر آخر قسم.
 */
function useScrollSpy(ids: string[], enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join('|')
  useEffect(() => {
    if (!enabled) return
    let ticking = false
    const run = () => {
      ticking = false
      const nav = document.getElementById('site-nav')
      const line = (nav?.offsetHeight || 90) + 40
      const sections = key
        .split('|')
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)
      let current: string | null = null
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section.id
      }
      if (sections.length && window.innerHeight + window.scrollY >= document.body.offsetHeight - 4) {
        current = sections[sections.length - 1].id
      }
      setActive(current)
    }
    const schedule = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(run)
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    run()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [key, enabled])
  return enabled ? active : null
}

/**
 * الترويسة «الجزيرة» العائمة للموقع العام: القوايم (القوالب، كيف تعمل، الباقات،
 * اطلب دعوتك…) حسب إعدادات الموقع، تبديل اللغة والمظهر، وقايمة الموبايل.
 * «اطلب دعوتك» بتتحوّل لواتساب لو الطلبات مقفولة، وبتتشال لو مفيش رقم.
 */
export function Header() {
  const { t } = useTranslation()
  const lang = useLang()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data: site } = useSite()
  const { data: user } = useMe()
  const [open, setOpen] = useState(false)
  const stuck = useStuck()

  const ordersEnabled = !!site?.ordersEnabled
  const plansPublic = !!site?.plansPublic
  const whatsappUrl = site?.whatsapp.url ?? ''
  const siteName = site ? pick(lang, site.name.ar, site.name.en) : ''

  const spyIds = ['templates', 'how', ...(plansPublic ? ['plans'] : []), 'faq']
  const active = useScrollSpy(spyIds, pathname === '/')

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      document.getElementById('nav-burger')?.focus()
    }
    // لو المستخدم كبّر الشاشة والقائمة مفتوحة
    const onResize = () => {
      if (window.innerWidth > DESKTOP_MIN) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const home = (hash: string) => ({ pathname: '/', hash })
  const spyClass = (id: string) => (active === id ? 'is-active' : undefined)

  // «اطلب دعوتك» (نموذج) أو «اطلب على واتساب»، أو لا شيء لو مفيش رقم
  const orderLabel = ordersEnabled ? t('public.nav.order') : t('public.nav.orderWhatsapp')
  const orderCta = (className: string) =>
    ordersEnabled ? (
      <Link className={className} to={home('#order')}>
        {orderLabel}
      </Link>
    ) : whatsappUrl ? (
      <a className={className} href={whatsappUrl} target="_blank" rel="noopener">
        {orderLabel}
      </a>
    ) : null

  return (
    <>
      <a className="skip-link" href="#main">
        {t('public.nav.skip')}
      </a>

      <header className={'nav' + (stuck ? ' is-stuck' : '')} id="site-nav">
        <div className="nav-shell">
          <Link
            className="brand"
            to="/"
            onClick={(event) => {
              // ثلاث ضغطات متتالية على الأيقونة = باب خلفي لصفحة تسجيل الدخول (‎detail‎ = عدد الضغطات المتتالية)
              if (event.detail < 3) return
              event.preventDefault()
              navigate('/login')
            }}
          >
            <span className="sr-only">{siteName}</span>
          </Link>

          <nav
            className={'nav-links' + (open ? ' is-open' : '')}
            id="nav-menu"
            aria-label={t('public.nav.main')}
            onClick={(event) => {
              if ((event.target as Element).closest('a')) setOpen(false)
            }}
          >
            <Link to={home('#templates')} className={spyClass('templates')}>
              {t('public.nav.templates')}
            </Link>
            <Link to={home('#how')} className={spyClass('how')}>
              {t('public.nav.how')}
            </Link>
            {plansPublic && (
              <Link to={home('#plans')} className={spyClass('plans')}>
                {t('public.nav.plans')}
              </Link>
            )}
            <Link to={home('#faq')} className={spyClass('faq')}>
              {t('public.nav.faq')}
            </Link>
            {user?.isStaff && <Link to="/dashboard">{t('public.nav.dashboard')}</Link>}
            {orderCta('btn btn--gold btn--sm nav-cta-inline')}
          </nav>

          <div className="nav-tools">
            <LanguageSwitch />
            <ThemeToggle />
            {orderCta('btn btn--gold btn--sm nav-cta')}
            <button
              className="nav-burger"
              id="nav-burger"
              type="button"
              aria-expanded={open}
              aria-controls="nav-menu"
              aria-label={open ? t('public.nav.closeMenu') : t('public.nav.openMenu')}
              onClick={() => setOpen((value) => !value)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <div className="nav-scrim" id="nav-scrim" hidden={!open} onClick={() => setOpen(false)} />
    </>
  )
}
