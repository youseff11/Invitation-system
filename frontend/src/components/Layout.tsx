// الأساس المشترك لازم يتحمّل قبل CSS الموقع العام (الترتيب هو اللي بيحدد مين
// يغلب مين) — main.tsx بيستورد نفس الملفات بعد App فمن غير السطور دي كان
// styles/app.css هيطلع بعد public.css ويغلبه.
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/app.css'
import '@/features/public/public.css'

import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { MetaPixel } from '@/features/public/metaPixel'
import { WhatsAppFloat } from '@/features/public/WhatsAppFloat'
import { scheduleWarm } from '@/features/public/warm'
import { Header } from './Header'

/** مسار الدخول: صفحة مستقلة من غير ترويسة ولا واتساب (زي ‎auth/login.html‎ القديم). */
const BARE_PATHS = new Set(['/login', '/login/'])

/** الصفحة الجديدة بتبدأ من فوق (الـSPA مابتحمّلش الصفحة من جديد)، والـhash بيتعامل معاه كل صفحة. */
function useScrollTopOnNavigate() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
}

/** غلاف الموقع العام: الترويسة، زر واتساب العائم، و Meta Pixel. */
export function Layout() {
  const { pathname } = useLocation()
  useScrollTopOnNavigate()
  useEffect(() => scheduleWarm(), [])

  return (
    <>
      <MetaPixel />
      {BARE_PATHS.has(pathname) ? (
        <Outlet />
      ) : (
        <>
          <Header />
          <WhatsAppFloat />
          <main id="main">
            <Outlet />
          </main>
        </>
      )}
    </>
  )
}
