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
 * إعادة تحميل ولا تبويب جديد، والرجوع منها كمان من غير إعادة تحميل. نفس الصفحة بتتقدّم
 * برضو من السيرفر (‎invite_page.template_page‎) لما الرابط يتفتح مباشرة أو يتشارك — هناك
 * الـ‎<head>‎ والـOG بيتبنوا على السيرفر.
 *
 * العارض بيعدّل الـ‎<head>‎ و‎<body>‎ و‎<html>‎؛ ‎useInviteDocument‎ بيرجّعهم لما الصفحة تتفك.
 * القوالب المستوردة (runtime خارجي) بتسيب مستمعين ومؤقّتات عامة مش ممكن ننضّفها —
 * دي بس بنعمل لها reload بعد التنضيف.
 */
let reloadOnLeave = false

/**
 * القالب المستورد (Tilda) بيحمّل مكتبات كاملة على ‎window‎ و‎document‎ — دي بس اللي مش بنعرف ننضّفها.
 * سكربتات المصمّم جوّه الأقسام («كود متقدّم») مربوطة بعناصر القسم وبتتشال معاه.
 */
function runsForeignCode(payload: Boot): boolean {
  return payload.mode === 'view' && (payload.stage.runtime || payload.runtimeScripts.length > 0)
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
 * حركات الدعوة). الـcleanup بيرجّع كل ده قبل ما الصفحة اللي بعدها تترسم (نفس الـcommit).
 */
function useInviteDocument() {
  useLayoutEffect(() => {
    const body = document.body
    const root = document.documentElement
    const saved = {
      theme: root.getAttribute('data-theme'),
      lang: root.getAttribute('lang'),
      dir: root.getAttribute('dir'),
      bodyClass: body.getAttribute('class'),
      bodyStyle: body.getAttribute('style'),
    }
    const restoreAttr = (el: Element, name: string, value: string | null) =>
      value === null ? el.removeAttribute(name) : el.setAttribute(name, value)

    body.classList.add('lb-doc')
    body.setAttribute('data-invite-root', '')
    body.setAttribute('data-ready', '1')
    root.removeAttribute('data-theme')

    const disabled: CSSStyleSheet[] = []
    const inviteSheets: CSSStyleSheet[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode
      if (!(owner instanceof Element)) continue
      if (isInviteSheet(owner)) {
        sheet.disabled = false // اتقفل في زيارة سابقة للمعاينة
        inviteSheets.push(sheet)
        continue
      }
      if (sheet.href && new URL(sheet.href, location.href).origin !== location.origin) continue // الخطوط
      sheet.disabled = true
      disabled.push(sheet)
    }

    const fonts = document.createElement('link')
    fonts.rel = 'stylesheet'
    fonts.href = FONTS_HREF
    document.head.appendChild(fonts)

    const title = document.title
    const description = document.querySelector('meta[name="description"]')
    const descriptionText = description?.getAttribute('content') ?? null

    return () => {
      // ستايل الدعوة بيعرّف ‎:root{--bg,--text,…}‎ وبيغلب ثيم الموقع (الداكن) لو فضل شغّال
      inviteSheets.forEach((sheet) => (sheet.disabled = true))
      document.head
        .querySelectorAll('style[data-font-faces], style[data-lb-layout-css], style[data-imported-css], style[data-zero-block-css]')
        .forEach((node) => node.remove())
      fonts.remove()
      disabled.forEach((sheet) => (sheet.disabled = false))
      restoreAttr(root, 'data-theme', saved.theme)
      restoreAttr(root, 'lang', saved.lang)
      restoreAttr(root, 'dir', saved.dir)
      restoreAttr(body, 'class', saved.bodyClass)
      restoreAttr(body, 'style', saved.bodyStyle)
      body.removeAttribute('data-invite-root')
      body.removeAttribute('data-ready')
      document.title = title
      if (description && descriptionText !== null) description.setAttribute('content', descriptionText)
      if (reloadOnLeave) {
        reloadOnLeave = false
        window.location.reload()
      }
    }
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
  useInviteDocument()

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    fetchRender({ kind: 'template', slug }, lang)
      .then((payload) => {
        if (!live) return
        const boot: Boot = { mode: 'view', ...payload }
        reloadOnLeave = runsForeignCode(boot)
        setState({ status: 'ready', boot })
      })
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
