import { useEffect, useLayoutEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { fetchRender } from './api'
import { InviteApp } from './InviteApp'
import type { Boot, InviteLang } from './types'
import './invite.css'
import './previewCritical.css'

/**
 * معاينة القالب جوّه التطبيق (SPA): الضغطة على «عرض القالب» بتفتح المعاينة من غير
 * إعادة تحميل ولا تبويب جديد. نفس الصفحة بتتقدّم برضو من السيرفر (‎invite_page.template_page‎)
 * لما الرابط يتفتح مباشرة أو يتشارك — هناك الـ‎<head>‎ والـOG بيتبنوا على السيرفر.
 *
 * العارض بيعدّل الـ‎<head>‎ و‎<body>‎ و‎<html>‎ (ستايل، لغة، اتجاه، سكربتات القالب المستورد)،
 * وده ملوّث للموقع العام لو رجعنا له من غير إعادة تحميل — فأي خروج من الصفحة
 * (رجوع/تقدّم في المتصفح) بيعمل reload للصفحة الجديدة عشان تبدأ نضيفة.
 */
let reloadOnLeaveArmed = false

function useHardReloadOnLeave() {
  useEffect(() => {
    // مفيش cleanup عن قصد: الـRouter بيفكّ الصفحة (flushSync) جوّه نفس حدث الـpopstate
    // قبل ما الـlistener ده يتنادى، فلو شلناه في الـcleanup عمره ما بيشتغل.
    if (reloadOnLeaveArmed) return
    reloadOnLeaveArmed = true
    const here = window.location.pathname
    window.addEventListener('popstate', () => {
      // تنقّل جوّه نفس الصفحة (anchor/hash) مش خروج
      if (window.location.pathname !== here) window.location.reload()
    })
  }, [])
}

/** نفس خطوط ‎templates/spa/invite.html‎ — الـshell بتاع الموقع بيحمّل ٣ عائلات بس. */
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@300;400;600;700&family=Cormorant+Garamond:wght@300;400;500;600&family=Gelasio:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Great+Vibes&family=Marcellus&family=Montserrat:wght@300;400;500;600&family=Playfair+Display:wght@400;500;600&family=Reem+Kufi:wght@400;600&family=Tajawal:wght@300;400;500;700&display=swap'

/** ستايل الدعوة نفسه (‎invite-*.css‎ في الـbuild، أو ‎features/invite/invite.css‎ في الـdev). */
const isInviteSheet = (owner: Element) =>
  /invite[-.]|TemplatePreviewPage|previewCritical/.test(owner.getAttribute('href') ?? owner.getAttribute('data-vite-dev-id') ?? '')

/**
 * الصفحة بتتعامل زي صفحة الدعوة المستقلة: ‎lb-doc‎ على ‎body‎، بدون ثيم الموقع، وبدون
 * ستايل الموقع العام (‎base.css‎ بيلوّن الروابط والعناوين، وقاعدة «تقليل الحركة» فيه بتوقف
 * حركات الدعوة). الخروج منها بـ reload (‎useHardReloadOnLeave‎) فمفيش داعي نرجّعهم.
 */
function useInviteDocument() {
  useLayoutEffect(() => {
    const body = document.body
    body.classList.add('lb-doc')
    body.setAttribute('data-invite-root', '')
    body.setAttribute('data-ready', '1')
    document.documentElement.removeAttribute('data-theme')

    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode
      if (!(owner instanceof Element) || isInviteSheet(owner)) continue
      if (sheet.href && new URL(sheet.href, location.href).origin !== location.origin) continue // الخطوط
      sheet.disabled = true
    }

    const fonts = document.createElement('link')
    fonts.rel = 'stylesheet'
    fonts.href = FONTS_HREF
    document.head.appendChild(fonts)
  }, [])
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; boot: Boot }
  | { status: 'missing' }
  | { status: 'error' }

export default function TemplatePreviewPage() {
  const { slug = '' } = useParams()
  const [search] = useSearchParams()
  const lang = (search.get('lang') === 'en' ? 'en' : search.get('lang') === 'ar' ? 'ar' : '') as InviteLang | ''
  const [state, setState] = useState<State>({ status: 'loading' })
  useHardReloadOnLeave()
  useInviteDocument()

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    fetchRender({ kind: 'template', slug }, lang)
      .then((payload) => live && setState({ status: 'ready', boot: { mode: 'view', ...payload } }))
      .catch((error: unknown) => {
        if (!live) return
        setState({ status: error instanceof ApiError && error.status === 404 ? 'missing' : 'error' })
      })
    return () => {
      live = false
    }
  }, [slug, lang])

  if (state.status === 'ready') return <InviteApp boot={state.boot} />
  if (state.status === 'missing') return <NotFoundPage />
  if (state.status === 'error') {
    return (
      <p role="alert" style={{ textAlign: 'center', padding: 40 }}>
        تعذّر تحميل المعاينة. <a href=".">حاول مرة أخرى</a>
      </p>
    )
  }
  return null
}
