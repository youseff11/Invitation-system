import type { FromFrame } from '../types'

/**
 * حدود القسم + مقبض الارتفاع (S6): إطار منقّط حوالين القسم المحدَّد ومقبض سفلي بيتسحب. السحب بيكتب الارتفاع على
 * طبقات القسم الفعلية لحظياً (‎!important‎ — القوالب المستوردة بتحط ارتفاعها على ‎.t396__artboard‎ وغيره)، وعند الإفلات بيتبعت
 * الرقم للأم (‎style.section_height_<مقاس>‎) فالسيرفر يولّد قاعدة الميديا الدايمة ويرجّعها مع الرسمة الجاية.
 * الاسم والمقاس بيجوا من الأم (مترجمين) — الإطار مالوش ترجمة المحرر.
 */
export interface Bounds {
  id: string
  /** ‎section_height_mobile|tablet|desktop‎ */
  key: string
  /** «حدود القسم · موبايل» — بيتضاف له الارتفاع الحالي */
  label: string
  /** الارتفاع المحفوظ للمقاس ده (٠ = ماحدّش سحب) */
  stored: number
}

export const MIN_HEIGHT = 120
export const MAX_HEIGHT = 2400
const STEP = 10
const SELECTORS = ['.lb-inner', '.lb-custom', '.lb-custom .t396__artboard', '.lb-custom .t396__filter', '.lb-custom .t396__carrier']

type Send = (message: FromFrame) => void

/** الارتفاع المقرَّب (لأقرب ١٠) داخل الحدود. */
export const snapHeight = (value: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value)) / STEP) * STEP

let cleanup: (() => void) | null = null

export function clearBounds(root: ParentNode = document) {
  cleanup?.()
  cleanup = null
  root.querySelectorAll('[data-lb-section-bounds]').forEach((n) => n.remove())
}

export function showBounds(bounds: Bounds | null, send: Send, root: ParentNode = document) {
  clearBounds(root)
  if (!bounds) return
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-block]')).find((n) => n.getAttribute('data-block') === bounds.id)
  if (!target) return
  const doc = target.ownerDocument
  const view = doc.defaultView
  if (view && view.getComputedStyle(target).position === 'static') target.style.position = 'relative'
  // الارتفاع الحقيقي للقسم المستورد على الـartboard مش على الـsection
  const artboard = target.querySelector<HTMLElement>('.t396__artboard') ?? target

  const overlay = doc.createElement('div')
  overlay.className = 'lb-section-bounds'
  overlay.setAttribute('data-lb-section-bounds', '1')
  overlay.setAttribute('aria-hidden', 'true')
  const label = doc.createElement('span')
  label.className = 'lb-section-bounds__label'
  const handle = doc.createElement('button')
  handle.type = 'button'
  handle.className = 'lb-section-resize-handle'
  overlay.append(label, handle)
  target.appendChild(overlay)

  const paint = (height: number) => {
    label.textContent = `${bounds.label} · ${height}px`
  }
  paint(bounds.stored > 0 ? bounds.stored : Math.round(artboard.getBoundingClientRect().height))

  const layers = () => [target, ...SELECTORS.flatMap((sel) => Array.from(target.querySelectorAll<HTMLElement>(sel)))]
  const setHeight = (value: number) => {
    const next = snapHeight(value)
    // min-height كمان: ‎.lb‎ عندها min-height من الحقل القديم، ومن غير كتابة فوقها القسم مابيصغّرش تحتها
    for (const node of layers()) {
      node.style.setProperty('height', `${next}px`, 'important')
      node.style.setProperty('min-height', `${next}px`, 'important')
    }
    paint(next)
    return next
  }

  let drag: { y0: number; h0: number; height: number } | null = null
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    drag = { y0: e.clientY, h0: artboard.getBoundingClientRect().height, height: 0 }
    handle.classList.add('is-dragging')
    doc.body.style.userSelect = 'none'
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      /* مش حرج */
    }
  })
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return
    e.preventDefault()
    drag.height = setHeight(drag.h0 + e.clientY - drag.y0)
  })
  const stop = () => {
    if (!drag) return
    const { height } = drag
    drag = null
    handle.classList.remove('is-dragging')
    doc.body.style.userSelect = ''
    if (height) send({ type: 'lb-editor:section-height', id: bounds.id, key: bounds.key, value: height })
  }
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)
  handle.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  cleanup = () => {
    drag = null
    doc.body.style.userSelect = ''
  }
}
