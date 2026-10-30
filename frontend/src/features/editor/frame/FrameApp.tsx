import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { BlockView } from '@/features/invite/blocks'
import { prefetchBlocks } from '@/features/invite/blocks/lazy'
import { InviteContext } from '@/features/invite/context'
import { syncHeadStyles } from '@/features/invite/head'
import { Intro } from '@/features/invite/Intro'
import { makeT } from '@/features/invite/strings'

import { INTRO_ID } from '../doc'
import type { PreviewPayload, ToFrame } from '../types'
import { parseMessage, sendToParent, shortcutKey } from './bridge'
import { installImported, markPicked, patchNode, prepareImported, revealPicked } from '../imported/frame'
import { installExtraDrags, prepareExtras } from './extraDrags'
import { installIntroClicks } from './introClicks'
import { clearBounds, showBounds, type Bounds } from './sectionBounds'
import { clearDragVars, editingNode, installInteractions, markEditable, patchText } from './interactions'
import { installNoHover, stripHover } from './noHover'

const EDITOR_MOD_KEYS = new Set(['s', 'z', 'y'])
const ELEMENT_MOD_KEYS = new Set(['c', 'v', 'd'])
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** ‎data-block‎ للقسم اللي اتضغط عليه (أو أقرب أب ليه). */
export function blockIdAt(target: EventTarget | null): string | null {
  const node = target instanceof Element ? target.closest('[data-block]') : null
  return node?.getAttribute('data-block') ?? null
}

/** لغة الصفحة واتجاهها ومتغيّرات الثيم على ‎<body>‎ — نسخة ‎applyPageMeta‎ من غير عنوان/وصف الدعوة. */
function applyBody(payload: PreviewPayload) {
  document.documentElement.setAttribute('lang', payload.lang)
  document.documentElement.setAttribute('dir', payload.dir)
  if ((document.body.getAttribute('style') || '') !== payload.bodyStyle) {
    document.body.setAttribute('style', payload.bodyStyle)
  }
}

/** علامة العنصر فوق القسم المحدَّد (‎.lb-ovl-picked‎) — بتتعاد بعد كل رسمة زي ‎markPicked‎. */
function markOverlay(picked: { id: string; index: number } | null) {
  document.querySelectorAll('.lb-ovl-picked').forEach((n) => n.classList.remove('lb-ovl-picked'))
  if (!picked) return
  const block = Array.from(document.querySelectorAll('[data-block]')).find((n) => n.getAttribute('data-block') === picked.id)
  block?.querySelector(`[data-section-text][data-section-text-index="${picked.index}"]`)?.classList.add('lb-ovl-picked')
}

function markSelected(id: string | null) {
  for (const node of document.querySelectorAll('[data-block]')) {
    node.classList.toggle('is-selected', node.getAttribute('data-block') === id)
  }
}

/**
 * المعاينة جوّه المحرر. الصفحة الأم بتبعت الحمولة (‎lb-editor:render‎) والـframe بيرسمها بنفس
 * مكوّنات عارض الدعوة، وبيرجّع الضغطات (تحديد قسم) واختصارات لوحة المفاتيح. مفيش شبكة هنا.
 * الافتتاحية بتتعرض فوق المسرح؛ ولما تتفتح بتفضل مقفولة مهما اتعدّل، وزرار «الافتتاحية» يعيدها.
 * لسه من غير الموسيقى ولا سكربتات القوالب المستوردة الأصلية (Tilda) — عدّاد القسم المستورد بس بيشتغل.
 */
export function FrameApp() {
  const [state, setState] = useState<{ payload: PreviewPayload; selected: string | null } | null>(null)
  // الافتتاحية بتقرا إعداداتها مرة عند التركيب، فبنعيد تركيبها (key) مع كل تعديل في محتواها —
  // إلا بعد ما تتفتح: مفتاحها يتجمّد على آخر محتوى عشان ماترجعش تغطي المعاينة مع كل حرف
  const [introRun, setIntroRun] = useState(0)
  // أقسام بنعيد تركيبها (مفتاح جديد) بعد تراجع/إعادة وهو بيكتب فيها
  const [remount, setRemount] = useState<Record<string, number>>({})
  const [introClosedAt, setIntroClosedAt] = useState<string | null>(null)
  const introSignature = useRef('')
  // آخر حمولة (لتفاعلات السحب والكتابة) + رد اتأجّل لأن المستخدم بيكتب في نص دلوقتي
  const payloadRef = useRef<PreviewPayload | null>(null)
  const pending = useRef<Extract<ToFrame, { type: 'lb-editor:render' }> | null>(null)
  // العنصر المحدَّد جوّه قسم مستورد (علامته بتتعاد بعد كل رسمة)
  const picked = useRef<{ id: string; slot: string } | null>(null)
  // العنصر فوق القسم المحدَّد (نص/صورة/زرار) — علامته بتتعاد بعد كل رسمة
  const pickedOverlay = useRef<{ id: string; index: number } | null>(null)
  // آخر حمولة اترسمت (عشان تغيّر التحديد لوحده مايمسحش إزاحة سحب مستنية رد السيرفر)
  const drawn = useRef<PreviewPayload | null>(null)
  // إطار حدود القسم المطلوب (الأم هي اللي بتحدّده) — بيتعاد بعد كل رسمة لأن القسم ممكن يتركّب من جديد
  const bounds = useRef<Bounds | null>(null)

  // كود (قسم أو افتتاحية) اتعدّل من اللوحة وعقدته الحية اتحدّثت بالفعل (‎lb-editor:node‎): رد السيرفر اللي بيأكّد نفس
  // التعديل ماينفعش يعيد حقن الكود (سكربتاته وحركاته كانت بتبدأ من الأول مع كل حرف) ولا يعيد تركيب الافتتاحية —
  // بنفضل نعرض الكود بالنص اللي اترسم بيه، وآخر نسخة صحيحة بتتعرض أول ما يتغيّر حاجة تانية
  // الـDOM الحي بيبقى مختلف عن اللي React فاكره (‎divergent‎) لحد أول رسمة مش مؤكِّدة (تراجع/إعادة أو رد متأخر):
  // وقتها بنعيد تركيب الكود فعلاً، وإلا نص التراجع (= اللي React فاكره) مايكتبش حاجة والمعدّل يفضل ظاهر.
  const patchedAt = useRef<Record<string, number>>({})
  const divergent = useRef(new Set<string>())
  const recentlyPatched = (id: string) => Date.now() - (patchedAt.current[id] ?? 0) < 5000
  const introShape = useRef('')
  const [introHeld, setIntroHeld] = useState<PreviewPayload['intro'] | null>(null)

  function applyRender(message: Extract<ToFrame, { type: 'lb-editor:render' }>) {
    let next = message.payload as PreviewPayload
    const before = payloadRef.current
    const bare = (block: PreviewPayload['blocks'][number]) => JSON.stringify({ ...block, code: '' })
    let held = false
    const fresh: string[] = []
    const blocks = next.blocks.map((block) => {
      const prev = before?.blocks.find((p) => p.id === block.id)
      if (prev && !message.force && recentlyPatched(block.id) && bare(prev) === bare(block)) {
        if (prev.code === block.code) return block
        held = true
        return { ...block, code: prev.code }
      }
      if (divergent.current.delete(block.id)) fresh.push(block.id)
      return block
    })
    if (held) next = { ...next, blocks }
    if (fresh.length) setRemount((r) => ({ ...r, ...Object.fromEntries(fresh.map((id) => [id, (r[id] ?? 0) + 1])) }))
    const shape = next.intro ? JSON.stringify({ ...next.intro, code: next.intro.code && { ...next.intro.code, html: '' } }) : ''
    const confirming = !message.force && recentlyPatched(INTRO_ID) && shape === introShape.current
    if (!confirming && divergent.current.delete(INTRO_ID)) setIntroRun((n) => n + 1)
    introShape.current = shape
    setIntroHeld((current) => (confirming ? (current ?? payloadRef.current?.intro ?? null) : null))
    introSignature.current = next.intro ? JSON.stringify(next.intro) : ''
    // اتقفلت من الإعدادات: المرة الجاية اللي تتفعّل فيها لازم تظهر من جديد
    if (!next.intro) setIntroClosedAt(null)
    setState({ payload: next, selected: message.selected })
  }
  const applyRenderRef = useRef(applyRender)
  applyRenderRef.current = applyRender

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = parseMessage<ToFrame>(event, window.parent)
      if (!message) return
      if (message.type === 'lb-editor:render') {
        // بيكتب في نص؟ الرد فيه النص القديم وتطبيقه كان هيمسح اللي اتكتب — نأجّله لحد ما يسيب النص.
        // إلا التراجع/الإعادة: هو اللي بيغيّر النص قصداً، فمايستناش
        const editing = editingNode()
        if (editing && !message.force) {
          pending.current = message
          return
        }
        if (editing) {
          // الكتابة غيّرت الـDOM من وراء React (ورسمتها اتأجّلت)، فلو النص بعد التراجع زي اللي React فاكره
          // مش هيكتب حاجة وكلامك يفضل ظاهر: نعيد تركيب القسم ده بس
          const id = blockIdAt(editing)
          if (id) setRemount((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
        }
        pending.current = null
        applyRender(message)
      } else if (message.type === 'lb-editor:element') {
        picked.current = message.id && message.slot ? { id: message.id, slot: message.slot } : null
        markPicked(picked.current)
        revealPicked() // اتحدّد من الطبقات وهو برّه الشاشة؟ ننزل له
      } else if (message.type === 'lb-editor:overlay-pick') {
        pickedOverlay.current = message.id && message.index !== null ? { id: message.id, index: message.index } : null
        markOverlay(pickedOverlay.current)
      } else if (message.type === 'lb-editor:bounds') {
        bounds.current = message.bounds
        showBounds(bounds.current, sendToParent)
      } else if (message.type === 'lb-editor:node') {
        patchedAt.current[message.id] = Date.now()
        divergent.current.add(message.id)
        patchNode(message.id, message.slot, message.edit)
      } else if (message.type === 'lb-editor:patch') {
        patchText(message.id, message.key, message.value)
      } else if (message.type === 'lb-editor:intro') {
        setIntroClosedAt(null)
        setIntroRun((n) => n + 1)
      } else if (message.type === 'lb-editor:intro-skip') {
        window.__lbIntro?.open() // نفس التلات ضغطات (introClicks) — لو الافتتاحية مش ظاهرة مفيش حاجة تتعمل
      } else if (message.type === 'lb-editor:select') {
        setState((current) => (current ? { ...current, selected: message.id } : current))
        if (message.scroll && message.id) {
          const node = Array.from(document.querySelectorAll('[data-block]')).find(
            (n) => n.getAttribute('data-block') === message.id,
          )
          node?.scrollIntoView({ block: 'center' })
        }
      }
    }
    window.addEventListener('message', onMessage)
    sendToParent({ type: 'lb-editor:ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // الكتابة المباشرة وسحب العناصر (تفويض أحداث على الصفحة) + تطبيق الرد المتأجّل لما المؤشر يسيب النص
  useEffect(() => {
    const flush = () =>
      setTimeout(() => {
        if (editingNode() || !pending.current) return
        const message = pending.current
        pending.current = null
        applyRenderRef.current(message)
      }, 0)
    document.addEventListener('focusout', flush)
    const stop = installInteractions({ payload: () => payloadRef.current, send: sendToParent })
    const stopExtra = installExtraDrags({ send: sendToParent })
    const stopIntroClicks = installIntroClicks({ payload: () => payloadRef.current, send: sendToParent })
    const stopNoHover = installNoHover() // مفيش hover في المحرر — لا تأثيرات القالب ولا إطارات المحرر
    const stopImported = installImported({
      payload: () => payloadRef.current,
      send: sendToParent,
      onPick: (next) => {
        picked.current = next
        markPicked(next)
      },
    })
    return () => {
      document.removeEventListener('focusout', flush)
      stop()
      stopImported()
      stopExtra()
      stopIntroClicks()
      clearBounds()
      stopNoHover()
    }
  }, [])

  // ضغطة على قسم = تحديده، ومفيش تنقّل ولا إرسال فورم جوّه المحرر
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href], button[type="submit"]')) event.preventDefault()
      const id = blockIdAt(event.target)
      if (id) sendToParent({ type: 'lb-editor:select', id })
      // ضغطة على أي حاجة غير العنصر فوق القسم بتلغي تحديده
      if (pickedOverlay.current && !(event.target instanceof Element && event.target.closest('[data-section-text]'))) {
        pickedOverlay.current = null
        markOverlay(null)
        sendToParent({ type: 'lb-editor:overlay-pick', id: null, index: null })
      }
    }
    const onSubmit = (event: Event) => event.preventDefault()
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.isContentEditable
      const mod = event.ctrlKey || event.metaKey
      // اختصارات المحرر بس (حفظ/تراجع/إعادة) — باقي Ctrl+حرف (تحديد الكل، نسخ، لصق…) للمتصفح جوّه النص.
      // استثناء: عنصر محدَّد مش بنكتب فيه — Ctrl+C/V/D بتنسخ/تلصق/تكرّر العنصر نفسه
      const pressed = mod ? shortcutKey(event) : event.key
      const lower = pressed.toLowerCase()
      const forElement = !typing && !!picked.current && !event.shiftKey && ELEMENT_MOD_KEYS.has(lower)
      if (mod && !EDITOR_MOD_KEYS.has(lower) && !forElement) return
      // الأسهم بتحرّك العنصر المحدَّد جوّه القسم المستورد (من غيره بتمرّر الصفحة زي العادي)
      const arrow = ARROWS.has(event.key) && !!picked.current
      if (!mod && (typing || !(arrow || ['Delete', 'Backspace', 'Escape'].includes(event.key)))) return
      if (mod || arrow) event.preventDefault()
      sendToParent({ type: 'lb-editor:key', key: pressed, shiftKey: event.shiftKey, mod })
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const payload = state?.payload
  const shownIntro = introHeld ?? payload?.intro
  const introJson = useMemo(() => (shownIntro ? JSON.stringify(shownIntro) : ''), [shownIntro])

  // الافتتاحية اتفتحت (لمسة، زرار، عدّاد، نهاية الفيديو): نفتكر محتواها عشان مانركّبهاش تاني
  useEffect(() => {
    const onOpen = () => setIntroClosedAt(introSignature.current)
    document.addEventListener('lb:intro-open', onOpen)
    return () => document.removeEventListener('lb:intro-open', onOpen)
  }, [])

  // الأم محتاجة تعرف الافتتاحية مغطّية المعاينة ولا لأ (زرار «تخطّي الافتتاحية»)
  const introShown = Boolean(payload?.intro) && introClosedAt === null
  useEffect(() => {
    sendToParent({ type: 'lb-editor:intro-visible', visible: introShown })
  }, [introShown])

  const ctx = useMemo(
    () =>
      payload
        ? { lang: payload.lang, t: makeT(payload.lang), maxWidth: payload.maxWidth, demo: true, hasIntro: Boolean(payload.intro) }
        : null,
    [payload],
  )

  // الستايل والتحديد بعد كل رسمة: React بيكتب ‎className‎ كاملة لو اتغيّرت فبيمسح ‎is-selected‎ و‎is-in‎
  useLayoutEffect(() => {
    if (!payload) return
    if (payload.css) syncHeadStyles(payload.css)
    stripHover() // ستايل جديد (قسم اتبدّل / CSS اتحدّث) بيتنضّف من الـhover
    applyBody(payload)
    document.querySelectorAll('.lb-anim').forEach((node) => node.classList.add('is-in')) // من غير حركة ظهور في المحرر
    payloadRef.current = payload
    markEditable(payload.blocks)
    prepareImported(payload, sendToParent)
    prepareExtras()
    if (bounds.current) showBounds(bounds.current, sendToParent)
    markPicked(picked.current)
    markOverlay(pickedOverlay.current)
    // الإزاحة الدايمة جاية من ستايل layout في الرأس (syncHeadStyles فوق) — بنمسح المؤقتة مع رسمة جديدة بس، مش مع تغيّر التحديد
    if (drawn.current !== payload) clearDragVars(document, payload.blocks)
    drawn.current = payload
    markSelected(state.selected)
  }, [payload, state?.selected, introRun, introClosedAt])

  useEffect(() => {
    if (payload) prefetchBlocks(new Set(payload.blocks.map((b) => b.type)))
  }, [payload])

  // عدّاد القسم المستورد (لو ليه موعد من الإعدادات): نفس اللي بيعمله عارض الدعوة، فالمصمّم يشوف الأرقام شغّالة وهو بيغيّر الموعد.
  // سكربتات القالب الأصلية (Tilda) مش بتتشغّل هنا — مابتتحمّلش بعد كل رسمة من غير ما تخبّط الـDOM اللي بنحفظه.
  const blocks = payload?.blocks
  useEffect(() => {
    if (!blocks?.some((b) => b.type === 'custom_html')) return
    let cancelled = false
    let stop = () => {}
    void import('@/features/invite/runtime/imported').then((m) => {
      if (!cancelled) stop = m.initImportedCountdowns()
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [blocks])

  if (!payload || !ctx) return null
  const { stage } = payload
  const stageClass = ['lb-stage', stage.full && 'lb-stage--full', stage.pattern && `lb-pattern lb-pattern--${stage.pattern}`]
    .filter(Boolean)
    .join(' ')

  return (
    <InviteContext.Provider value={ctx}>
      {payload.intro && shownIntro && <Intro key={`${introRun}:${introClosedAt ?? introJson}`} data={shownIntro} />}
      <div className={stageClass}>
        {payload.blocks.map((block) => (
          <BlockView key={`${block.id}:${remount[block.id] ?? 0}`} block={block} />
        ))}
        {payload.showBranding && (
          <footer className="lb-footer">
            {ctx.t('footer.designedBy')} <span>{payload.siteName}</span>
          </footer>
        )}
      </div>
    </InviteContext.Provider>
  )
}
