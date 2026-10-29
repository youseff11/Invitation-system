import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { fetchRender, type Source } from './api'
import { BlockView } from './blocks'
import { prefetchBlocks } from './blocks/lazy'
import { LangToggle, PreviewCtaBar, PreviewShare } from './Chrome'
import { InviteContext } from './context'
import { applyPageMeta, syncHeadStyles } from './head'
import { Intro } from './Intro'
import { Music } from './Music'
import { initFarhaState, guardCodeRoots } from './runtime/code-roots'
import { initImportedMedia } from './runtime/media'
import { bindScrollLinks } from './runtime/scroll-links'
import { makeT } from './strings'
import type { Boot, InviteLang, RenderPayload } from './types'

const AutoScroll = lazy(() => import('./AutoScroll').then((m) => ({ default: m.AutoScroll })))
const Locked = lazy(() => import('./Locked').then((m) => ({ default: m.Locked })))
const DATA_ATTR = /^data-[a-zA-Z0-9_-]{1,64}$/

/** حركات الظهور: القسم بيظهر أول ما يقرّب من الشاشة (قبلها بـ٤٥٪ عشان الانتقال يخلص). */
const PENDING = '.lb-anim:not(.is-in)'

function useReveal(dep: unknown) {
  useEffect(() => {
    const scan = (observe: (node: Element) => void) =>
      document.querySelectorAll(PENDING).forEach(observe)
    if (!('IntersectionObserver' in window)) {
      scan((n) => n.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        })
      },
      // threshold:0 = أول ما أي جزء يلمس صندوق القياس؛ ٤٥٪ بتمدّه تحت الشاشة
      { threshold: 0, rootMargin: '0px 0px 45% 0px' },
    )
    const watch = (node: Element) => io.observe(node)
    scan(watch)
    // الأقسام اللي بتتحمّل متأخر (فيديو، معرض، RSVP) بتحلّ محل مكانها الفاضي بعنصر جديد
    // مالوش مراقب — من غير ده يفضل opacity:0 للأبد (الفيديو بيشتغل بس مش باين)
    const mo = new MutationObserver((records) => {
      const added = records.some((r) =>
        Array.from(r.addedNodes).some(
          (n) => n instanceof Element && (n.matches(PENDING) || n.querySelector(PENDING)),
        ),
      )
      if (added) scan(watch)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [dep])
}

function sourceOf(payload: RenderPayload): Source {
  return { kind: payload.kind, slug: payload.slug, guestToken: payload.guest?.token }
}

function Viewer({ initial }: { initial: RenderPayload }) {
  const [payload, setPayload] = useState(initial)
  const [busy, setBusy] = useState(false)
  const cache = useRef(new Map<InviteLang, RenderPayload>([[initial.lang, initial]]))
  const [hasIntro] = useState(() => Boolean(initial.intro))

  const t = useMemo(() => makeT(payload.lang), [payload.lang])
  const ctx = useMemo(
    () => ({
      lang: payload.lang,
      t,
      maxWidth: payload.maxWidth,
      demo: payload.demo,
      hasIntro,
    }),
    [payload.lang, payload.maxWidth, payload.demo, hasIntro, t],
  )

  // لو الحمولة جت من الـAPI (بعد كلمة السر) الستايل لسه مااتطبعش في الـhead
  useLayoutEffect(() => {
    if (initial.css) {
      syncHeadStyles(initial.css)
      applyPageMeta(initial)
    }
  }, [initial])

  useEffect(() => {
    initFarhaState()
    return bindScrollLinks()
  }, [])

  // قوالب مستوردة (Tilda…): سكربتات الـruntime بتتنفّذ بالترتيب بعد ما الأقسام تتحط
  useEffect(() => {
    if (!initial.stage.runtime || !initial.runtimeScripts.length) return
    void import('./runtime/imported').then((m) => {
      if (initial.runtimeIsSpa) m.installSpaBridge()
      void m.loadTemplateRuntime(initial.runtimeScripts)
    })
  }, [initial])

  // الأجزاء التقيلة (فورم الرد، الفيديو) بتتجاب في الخلفية بعد أول رسمة
  useEffect(() => {
    const types = new Set(initial.blocks.map((b) => b.type))
    const run = () => prefetchBlocks(types)
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 1200)
    return () => window.clearTimeout(id)
  }, [initial])

  // حمايات كود المصمّم وعدّادات/فيديوهات المستورد: بعد كل تغيير في المحتوى
  const hasImported = payload.blocks.some((b) => b.type === 'custom_html')
  useEffect(() => {
    guardCodeRoots()
    initImportedMedia()
    if (!hasImported) return
    let cancelled = false
    let stop = () => {}
    void import('./runtime/imported').then((m) => {
      if (!cancelled) stop = m.initImportedCountdowns()
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [payload.blocks, hasImported])

  useReveal(payload.blocks)

  const { altLang, kind } = payload
  const switchLang = useCallback(
    async (target: InviteLang) => {
      setBusy(true)
      const url = new URL(location.href)
      url.searchParams.set('lang', target)
      // الضغطة **لازم** تنتهي بنتيجة: لو الشبكة بطيئة ننتقل بالرابط عادي
      const giveUp = window.setTimeout(() => {
        window.location.href = url.toString()
      }, 2500)
      try {
        const next = cache.current.get(target) ?? (await fetchRender(sourceOf(initial), target))
        cache.current.set(target, next)
        window.clearTimeout(giveUp)
        if (next.css) syncHeadStyles(next.css)
        applyPageMeta(next)
        try {
          window.history.replaceState({}, '', url.toString())
        } catch {
          /* مش حرج */
        }
        setPayload(next)
        document.dispatchEvent(new CustomEvent('lb:content-swapped', { detail: { lang: next.lang, inPlace: true } }))
      } catch {
        window.clearTimeout(giveUp)
        window.location.href = url.toString()
        return
      }
      setBusy(false)
    },
    [initial],
  )

  // اللغة التانية بتتجاب في الخلفية عشان الضغطة تبقى فورية (من غير شبكة ضعيفة أو موفّر بيانات)
  useEffect(() => {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    if (conn?.saveData || /(^|-)2g$/.test(String(conn?.effectiveType ?? ''))) return
    if (!initial.hasAlt || cache.current.has(initial.altLang)) return
    const run = () => {
      fetchRender(sourceOf(initial), initial.altLang)
        .then((next) => cache.current.set(initial.altLang, next))
        .catch(() => {})
    }
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 1500)
    return () => window.clearTimeout(id)
  }, [initial])

  const { stage } = payload
  const stageClass = [
    'lb-stage',
    stage.runtime && 'lb-stage--runtime t-records t-records_animated t-records_visible',
    stage.full && 'lb-stage--full',
    stage.pattern && `lb-pattern lb-pattern--${stage.pattern}`,
  ]
    .filter(Boolean)
    .join(' ')
  const rootAttrs: Record<string, string> = {}
  if (stage.runtime) {
    rootAttrs.id = 'allrecords'
    for (const [key, value] of Object.entries(stage.rootAttrs)) {
      if (DATA_ATTR.test(key)) rootAttrs[key] = String(value)
    }
  }

  return (
    <InviteContext.Provider value={ctx}>
      {payload.hasAlt && <LangToggle altLang={altLang} onSwitch={switchLang} busy={busy} />}
      {payload.intro && <Intro data={payload.intro} />}
      <div {...rootAttrs} className={stageClass}>
        {payload.blocks.map((block) => (
          <BlockView key={block.id} block={block} />
        ))}
        {payload.showBranding && (
          <footer className="lb-footer">
            {t('footer.designedBy')}{' '}
            <a href={payload.siteUrl || '/'} target="_blank" rel="noopener">
              {payload.siteName}
            </a>
          </footer>
        )}
      </div>
      {payload.scroll.enabled && (
        <Suspense fallback={null}>
          <AutoScroll config={payload.scroll} />
        </Suspense>
      )}
      {kind === 'template' && <PreviewShare name={payload.cta?.template_name ?? ''} />}
      {kind === 'template' && payload.cta && <PreviewCtaBar cta={payload.cta} />}
      {payload.music && <Music config={payload.music} />}
    </InviteContext.Provider>
  )
}

/** جذر صفحة الدعوة: كلمة السر أو العارض. */
export function InviteApp({ boot }: { boot: Boot }) {
  const [unlocked, setUnlocked] = useState<RenderPayload | null>(null)
  if (boot.mode === 'locked') {
    return unlocked ? (
      <Viewer initial={unlocked} />
    ) : (
      <Suspense fallback={null}>
        <Locked slug={boot.slug} onUnlocked={setUnlocked} />
      </Suspense>
    )
  }
  return <Viewer initial={boot} />
}
