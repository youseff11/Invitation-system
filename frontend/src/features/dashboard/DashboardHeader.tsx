import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useLogout, useMe, useSetLanguage, useSite } from '@/api/hooks'
import type { Lang } from '@/api/types'
import { applyDocumentLanguage } from '@/i18n'
import { useTheme } from '@/lib/theme'

import { prefetchAllChunks, prefetchDashboard } from './prefetch'

interface NavItem {
  to: string
  label: string
  active: (path: string) => boolean
}

/** مجموعة بتتفتح بزرار: الروابط جواها بتظهر في قايمة منسدلة بدل ما تزحم الشريط. */
interface NavGroupDef {
  group: string
  items: NavItem[]
}

const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`)

/** مكتبة الوسائط: الخطوط والموسيقى والفيديوهات والافتتاحيات — بتتجمّع تحت زرار «المكتبة». */
const LIBRARY: NavGroupDef = {
  group: 'library',
  items: [
    { to: '/dashboard/fonts', label: 'fonts', active: under('/dashboard/fonts') },
    { to: '/dashboard/music', label: 'music', active: under('/dashboard/music') },
    { to: '/dashboard/videos', label: 'videos', active: under('/dashboard/videos') },
    { to: '/dashboard/intros', label: 'intros', active: under('/dashboard/intros') },
  ],
}

/** روابط اللوحة بالترتيب (الباقات مفعّلة مع الإعدادات كمان). */
const NAV: (NavItem | NavGroupDef)[] = [
  { to: '/dashboard', label: 'home', active: (path) => path === '/dashboard' },
  { to: '/dashboard/invitations', label: 'invitations', active: under('/dashboard/invitations') },
  { to: '/dashboard/templates', label: 'templates', active: under('/dashboard/templates') },
  LIBRARY,
  { to: '/dashboard/orders', label: 'orders', active: under('/dashboard/orders') },
  {
    to: '/dashboard/plans',
    label: 'plans',
    active: (path) => under('/dashboard/plans')(path) || under('/dashboard/site')(path),
  },
  { to: '/dashboard/analytics', label: 'analytics', active: under('/dashboard/analytics') },
]

/**
 * زرار بيفتح قايمة منسدلة بروابط المجموعة. بيتقفل بالضغط برّه أو Escape (والتركيز
 * بيرجع للزرار) أو باختيار رابط أو أي تغيير في الصفحة. «الصفحة اللي اتفتحت عليها»
 * هي اللي بتحدد الفتح، فالتنقل (حتى بزرار الرجوع) بيقفلها من غير effect.
 */
function NavGroup({ def, pathname }: { def: NavGroupDef; pathname: string }) {
  const { t } = useTranslation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const active = def.items.some((item) => item.active(pathname))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenAt(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpenAt(null)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className={open ? 'nav-group is-open' : 'nav-group'}>
      <button
        ref={buttonRef}
        type="button"
        className={active ? 'nav-group-btn is-active' : 'nav-group-btn'}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpenAt(open ? null : pathname)}
      >
        {t(`dashboard.nav.${def.group}`)}
        <svg className="nav-group-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      <div className="nav-sub" id={menuId}>
        {def.items.map((item) => (
          <Link key={item.to} to={item.to} className={item.active(pathname) ? 'is-active' : undefined}>
            {t(`dashboard.nav.${item.label}`)}
          </Link>
        ))}
      </div>
    </div>
  )
}

/** النزول (بالبكسل) اللي بعده الترويسة بتتقلّص، والرجوع اللي تحته بتكبر تاني. */
const STUCK_ON = 24
const STUCK_OFF = 4

/** ‎window.innerWidth‎ اللي فوقه القائمة بتتقفل لوحدها (زي site.js القديم). */
const DESKTOP_AT = 900

/** الترويسة العائمة بتاعة اللوحة — نفس ‎partials/nav.html‎ مع ‎dash=True‎. */
export function DashboardHeader() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data: user } = useMe()
  const { data: site } = useSite()
  const logout = useLogout()
  const queryClient = useQueryClient()
  // الصفحة (chunk + بياناتها) بتتسخّن أول ما المؤشر/التركيز/اللمس يوصل لرابطها، فالضغطة تلاقيها جاهزة
  const warm = (event: { target: EventTarget }) => {
    const link = (event.target as HTMLElement).closest?.('a')
    const href = link?.getAttribute('href')
    if (href?.startsWith('/dashboard')) prefetchDashboard(queryClient, href)
  }
  useEffect(() => prefetchAllChunks(queryClient), [queryClient])
  const setLanguage = useSetLanguage()
  const toggleTheme = useTheme((state) => state.toggle)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stuck, setStuck] = useState(false)

  const lang = (i18n.language as Lang) ?? 'ar'
  const next: Lang = lang === 'ar' ? 'en' : 'ar'
  const siteName = site?.name[lang] ?? ''
  const switchTitle = lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'

  // الترويسة بتتقلّص وتاخد ظل لما المستخدم ينزل بالصفحة
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        // عتبتين مختلفتين (تشغيل ≠ إيقاف): من غير كده التذبذب حوالين نقطة واحدة بيرعّش الترويسة
        setStuck((was) => (was ? window.scrollY > STUCK_OFF : window.scrollY > STUCK_ON))
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // القائمة (الموبايل): Escape وتكبير الشاشة بيقفلوها
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onResize = () => {
      if (window.innerWidth > DESKTOP_AT) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  function switchLanguage(event: FormEvent) {
    event.preventDefault()
    setLanguage.mutate(next, {
      onSuccess: () => {
        void i18n.changeLanguage(next)
        applyDocumentLanguage(next)
      },
    })
  }

  function signOut(event: FormEvent) {
    event.preventDefault()
    // نخرج من منطقة اللوحة الأول، وإلا الحارس هيرجّعنا لصفحة الدخول بدل الرئيسية
    navigate('/', { replace: true })
    logout.mutate()
  }

  return (
    <>
      <header className={stuck ? 'nav is-stuck' : 'nav'} id="site-nav">
        <div className="nav-shell">
          <Link className="brand" to="/">
            <span className="sr-only">{siteName}</span>
          </Link>

          <nav
            className={menuOpen ? 'nav-links is-open' : 'nav-links'}
            id="nav-menu"
            aria-label={t('dashboard.nav.main')}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) setMenuOpen(false)
            }}
            onPointerOver={warm}
            onFocus={warm}
            onTouchStart={warm}
          >
            {NAV.map((item) =>
              'group' in item ? (
                <NavGroup key={item.group} def={item} pathname={pathname} />
              ) : (
                <Link key={item.to} to={item.to} className={item.active(pathname) ? 'is-active' : undefined}>
                  {t(`dashboard.nav.${item.label}`)}
                </Link>
              ),
            )}
            <Link to="/dashboard/data" className={pathname.startsWith('/dashboard/data') ? 'is-active' : undefined}>
              {t('dashboard.nav.admin')}
            </Link>
            <Link className="nav-only-mobile" to="/">
              {t('dashboard.nav.publicSite')}
            </Link>
            <form className="nav-only-mobile nav-logout-inline" onSubmit={signOut}>
              <button className="btn btn--ghost btn--sm btn--block" type="submit">
                {t('dashboard.nav.logout')} ({user?.username})
              </button>
            </form>
          </nav>

          <div className="nav-tools">
            <form className="lang-form" onSubmit={switchLanguage}>
              <button
                className={setLanguage.isPending ? 'lang-btn is-busy' : 'lang-btn'}
                type="submit"
                title={switchTitle}
                aria-label={switchTitle}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3.5 9.2h17M3.5 14.8h17" />
                  <path d="M12 3c2.6 2.5 4 5.5 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.5-4-9s1.4-6.5 4-9Z" />
                </svg>
                <span>{lang === 'ar' ? 'EN' : 'ع'}</span>
              </button>
            </form>

            <button
              className="icon-btn"
              type="button"
              onClick={toggleTheme}
              aria-label={t('dashboard.nav.theme')}
            >
              <svg
                className="i-sun"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
              </svg>
              <svg
                className="i-moon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.9 6.9 0 0 0 10.8 10.8Z" />
              </svg>
            </button>

            <form className="nav-logout" onSubmit={signOut}>
              <button className="btn btn--ghost btn--sm nav-cta" type="submit">
                {t('dashboard.nav.logout')}
              </button>
            </form>

            <button
              className="nav-burger"
              id="nav-burger"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="nav-menu"
              aria-label={menuOpen ? t('dashboard.nav.closeMenu') : t('dashboard.nav.openMenu')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <div className="nav-scrim" id="nav-scrim" hidden={!menuOpen} onClick={() => setMenuOpen(false)} />
    </>
  )
}
