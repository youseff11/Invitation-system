import type { FromFrame } from '../types'

/**
 * سحب «عناصر فوق القسم» (‎[data-section-text]‎: نص/صورة/زرار) وعناصر الشاشة الافتتاحية (‎[data-intro-item]‎) — S6.
 * زي ‎interactions.ts‎: تفويض على ‎document‎ مرة واحدة، والنتيجة النهائية بتتبعت للأم (صاحبة المستند). الإزاحة اللحظية
 * بتتكتب على العقدة كمتغيّر CSS (زي ما السيرفر بيرسمها) فتبان من غير رد من السيرفر.
 */

const THRESHOLD = 4
const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const num = (value: string) => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/** حدود نفس القديم: النص فوق القسم نسبة من حاويته (واسعة)، وعناصر الافتتاحية ±٣٥ من الشاشة */
export const OVERLAY_RANGE = 1000
export const INTRO_RANGE = 35
export const WIDTH_MIN = 8
export const WIDTH_MAX = 100

type Send = (message: FromFrame) => void

/** بعد كل رسمة: مقبضا العرض على كل عنصر فوق القسم (لو مش موجودين)، وعلامة «الافتتاحية قابلة للتحرير» للـCSS. */
export function prepareExtras(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-section-text]').forEach((node) => {
    if (node.querySelector(':scope > .lb-section-text__grip')) return
    for (const side of ['start', 'end']) {
      const grip = node.ownerDocument.createElement('span')
      grip.className = `lb-section-text__grip lb-section-text__grip--${side}`
      grip.setAttribute('aria-hidden', 'true')
      node.appendChild(grip)
    }
  })
  root.querySelectorAll('.lb-intro').forEach((intro) => intro.setAttribute('data-intro-editable', ''))
}

interface Drag {
  kind: 'overlay' | 'intro' | 'width'
  node: HTMLElement
  pointerId: number
  x0: number
  y0: number
  moved: boolean
  /** بداية الإزاحة (x,y) */
  startX: number
  startY: number
  /** أبعاد الحاوية للتحويل لنسبة */
  width: number
  height: number
  /** للعرض: عرض العنصر عند البداية، واتجاه المقبض (-١ شمال/+١ يمين) */
  startWidth: number
  dir: number
  x: number
  y: number
  percent: number
}

export function installExtraDrags({ send }: { send: Send }): () => void {
  let drag: Drag | null = null
  let suppressClick = false

  const holderOf = (node: HTMLElement) => node.closest<HTMLElement>('.lb-video-wrap') ?? node.closest<HTMLElement>('[data-block]')
  const blockId = (node: HTMLElement) => node.closest('[data-block]')?.getAttribute('data-block') ?? null
  const index = (node: HTMLElement) => parseInt(node.getAttribute('data-section-text-index') ?? '', 10)

  /** الضغطة على عنصر فوق القسم بتحدّده (للحذف والعلامة) — من قبل السحب، فالسحب نفسه بيحدّده كمان */
  const pick = (node: HTMLElement) => {
    const id = blockId(node)
    const at = index(node)
    if (id && !Number.isNaN(at)) send({ type: 'lb-editor:overlay-pick', id, index: at })
  }

  const base = (kind: Drag['kind'], node: HTMLElement, e: PointerEvent): Drag => ({
    kind, node, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
    startX: 0, startY: 0, width: 1, height: 1, startWidth: 0, dir: 1, x: 0, y: 0, percent: 0,
  })

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag || !(e.target instanceof Element)) return

    // مقبض العرض: عرض الصندوق نسبة من الحاوية (الصندوق متمركز فسحب جنب واحد بيوسّع الجنبين ← ×٢)
    const grip = e.target.closest<HTMLElement>('.lb-section-text__grip')
    if (grip) {
      const node = grip.closest<HTMLElement>('[data-section-text]')
      const holder = node && holderOf(node)
      if (!node || !holder) return
      pick(node)
      const nodeRect = node.getBoundingClientRect()
      const gripRect = grip.getBoundingClientRect()
      e.preventDefault()
      e.stopPropagation()
      drag = {
        ...base('width', node, e),
        width: Math.max(1, holder.getBoundingClientRect().width),
        startWidth: nodeRect.width,
        // الاتجاه من موضع المقبض الفعلي مش من اسمه: بيفضل مظبوط في RTL وLTR
        dir: gripRect.left + gripRect.width / 2 < nodeRect.left + nodeRect.width / 2 ? -1 : 1,
      }
      return
    }

    const overlay = e.target.closest<HTMLElement>('[data-section-text]')
    if (overlay) {
      const holder = holderOf(overlay)
      if (!holder || !blockId(overlay) || Number.isNaN(index(overlay))) return
      const rect = holder.getBoundingClientRect()
      pick(overlay)
      drag = {
        ...base('overlay', overlay, e),
        startX: num(overlay.style.getPropertyValue('--video-text-x')),
        startY: num(overlay.style.getPropertyValue('--video-text-y')),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      }
      drag.x = drag.startX
      drag.y = drag.startY
      return
    }

    // عناصر الافتتاحية (زرار، نص، اسم الضيف، صندوق الكود). عنصر ‎data-move‎ جوّه كود الافتتاحية بيتسحب لوحده (interactions)
    const item = e.target.closest<HTMLElement>('.lb-intro [data-intro-item]')
    if (!item || e.target.closest('a, input, video, [contenteditable], [data-move]:not([data-intro-item])')) return
    const view = item.ownerDocument.defaultView
    drag = {
      ...base('intro', item, e),
      startX: num(item.style.getPropertyValue('--intro-item-x')),
      startY: num(item.style.getPropertyValue('--intro-item-y')),
      width: Math.max(1, view?.innerWidth ?? 1) / 100,
      height: Math.max(1, view?.innerHeight ?? 1) / 100,
    }
    drag.x = drag.startX
    drag.y = drag.startY
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    if (!drag.moved) {
      const limit = drag.kind === 'width' ? 3 : THRESHOLD
      if (Math.abs(dx) < limit && (drag.kind === 'width' || Math.abs(dy) < limit)) return
      drag.moved = true
      try {
        drag.node.setPointerCapture(e.pointerId)
      } catch {
        /* مش حرج */
      }
      drag.node.classList.add(drag.kind === 'intro' ? 'lb-intro-dragging' : 'is-dragging')
      e.preventDefault()
    }
    e.preventDefault()
    e.stopPropagation()
    if (drag.kind === 'width') {
      const next = ((drag.startWidth + 2 * dx * drag.dir) / drag.width) * 100
      // ١٠٠٪ هو نفس max-width في invite.css — لو عدّيناه القيمة المحفوظة هتقول رقم والشاشة تعرض رقم تاني
      drag.percent = Math.round(clamp(next, WIDTH_MIN, WIDTH_MAX) * 10) / 10
      drag.node.style.setProperty('--section-text-w', `${drag.percent}%`)
    } else if (drag.kind === 'overlay') {
      drag.x = round2(clamp(drag.startX + (dx / drag.width) * 100, -OVERLAY_RANGE, OVERLAY_RANGE))
      drag.y = round2(clamp(drag.startY + (dy / drag.height) * 100, -OVERLAY_RANGE, OVERLAY_RANGE))
      drag.node.style.setProperty('--video-text-x', `${drag.x}%`)
      drag.node.style.setProperty('--video-text-y', `${drag.y}%`)
    } else {
      drag.x = round2(clamp(drag.startX + dx / drag.width, -INTRO_RANGE, INTRO_RANGE))
      drag.y = round2(clamp(drag.startY + dy / drag.height, -INTRO_RANGE, INTRO_RANGE))
      drag.node.style.setProperty('--intro-item-x', `${drag.x}vw`)
      drag.node.style.setProperty('--intro-item-y', `${drag.y}vh`)
    }
  }

  const finish = (cancel: boolean) => (e: PointerEvent) => {
    if (!drag) return
    const d = drag
    drag = null
    try {
      d.node.releasePointerCapture(d.pointerId)
    } catch {
      /* مش حرج */
    }
    d.node.classList.remove('lb-intro-dragging', 'is-dragging')
    if (!d.moved) return
    // السحب مش ضغطة: ما يفتحش الدعوة (الافتتاحية) ولا يمشي على لينك الزرار
    suppressClick = true
    setTimeout(() => {
      suppressClick = false
    }, 0)
    e.preventDefault()
    e.stopPropagation()
    if (cancel) return
    if (d.kind === 'intro') {
      const key = d.node.getAttribute('data-intro-item')
      if (key) send({ type: 'lb-editor:intro-item', key, x: d.x, y: d.y })
      return
    }
    const id = blockId(d.node)
    const at = index(d.node)
    if (!id) return
    if (d.kind === 'width') send({ type: 'lb-editor:overlay', id, index: at, values: { width: d.percent } })
    else send({ type: 'lb-editor:overlay', id, index: at, values: { x: d.x, y: d.y } })
  }

  const onPointerUp = finish(false)
  const onPointerCancel = finish(true)

  // رابط الزرار فوق القسم لينك حقيقي (عشان الضيف يدوس عليه): جوّه المحرر الضغطة معناها «اختار القسم»
  const onClick = (e: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.target instanceof Element && e.target.closest('[data-section-text] a[href]')) e.preventDefault()
  }

  // صورة أو لينك جوّه عنصر فوق القسم: المتصفح كان بيبدأ «سحب صورة/لينك» أصلي أول ما الماوس يتحرّك فيلغي سحبنا (pointercancel)،
  // فالمصمّم كان محتاج ضغطتين. ممنوع السحب الأصلي هنا.
  const onDragStart = (e: DragEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-section-text]')) e.preventDefault()
  }

  document.addEventListener('dragstart', onDragStart, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('dragstart', onDragStart, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('click', onClick, true)
  }
}
