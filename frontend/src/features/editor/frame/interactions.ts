import type { BlockData } from '@/features/invite/types'

import { INTRO_ID } from '../doc'
import { commitHtml, commitSwap } from '../imported/frame'
import type { FromFrame, PreviewPayload } from '../types'

/**
 * تفاعلات المعاينة: كتابة مباشرة في النصوص (‎[data-slot]‎) وسحب العناصر (‎[data-move]‎).
 * كل ده DOM مباشر على صفحة الدعوة اللي React راسمها: الربط بالتفويض (listeners على ‎document‎ مرة
 * واحدة) فمايتضاعفش مع كل رسمة، والنتيجة بتتبعت للصفحة الأم (‎FromFrame‎) اللي هي صاحبة المستند.
 * الأقسام المستوردة وصناديق «كود متقدّم» وعناصر الافتتاحية بتتحرّك في C4b — هنا العناصر العادية بس.
 */

/** cqw = ١٪ من عرض المسرح (‎.lb-stage‎ حاوية قياس) — بنفس ثوابت ‎editor.js‎ القديم */
export const SNAP = 1.2
/** لزق الصفر لعناصر القوالب المستوردة (بالبكسل) */
export const SNAP_PX = 4
/** تبديل صورتين: الماوس لازم تكون جوّه الـ٦٠٪ الوسطانية من الصورة التانية */
const SWAP_INNER = 0.6
export const THRESHOLD = 4
export const FINE = 0.25
export const MAX_OFFSET = 1000

// ‎el-N‎ (قالب مستورد) و‎ce-N‎ و‎code‎ إزاحتها بالبكسل (مش cqw): جوّه شبكة Tilda الثابتة
const PX_SLOT = /^(?:el|ce)-\d{1,4}$/
export const isPxSlot = (slot: string | null | undefined) => slot === 'code' || PX_SLOT.test(slot ?? '')

const NON_TEXT = /^(img|video|audio|iframe|input|textarea|select|canvas|svg|picture|source)$/i

// ---------------------------------------------------------------- رياضيات السحب (نقية)
export interface DragMath {
  dx: number
  dy: number
  snapX: boolean
  snapY: boolean
}

/** وحدة الإزاحة لخانة: بكسل لعناصر المستورد، وإلا cqw — نفس ‎layout_css‎ على السيرفر. */
export const slotUnit = (slot: string | null | undefined) => (isPxSlot(slot) ? 'px' : 'cqw')

const clamp = (v: number) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v))
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * الإزاحة الجديدة من حركة الماوس بالبكسل: ‎unit‎ = بكسل لكل وحدة إزاحة (cqw = ١٪ من المسرح، أو ١ للبكسل)،
 * و‎fine‎ (Shift) بيبطّأ للربع. أي محور يقرب من الصفر لحد ‎snap‎ بيلزق عليه (والواجهة بترسم خط إرشاد).
 */
export function dragOffset(
  start: { dx0: number; dy0: number },
  deltaPx: { x: number; y: number },
  unit: number,
  fine = false,
  snap = SNAP,
): DragMath {
  const k = (fine ? FINE : 1) / (unit || 1)
  let dx = start.dx0 + deltaPx.x * k
  let dy = start.dy0 + deltaPx.y * k
  const snapX = Math.abs(dx) < snap
  const snapY = Math.abs(dy) < snap
  if (snapX) dx = 0
  if (snapY) dy = 0
  return { dx: round2(clamp(dx)), dy: round2(clamp(dy)), snapX, snapY }
}

// ---------------------------------------------------------------- النصوص القابلة للكتابة
const byId = (blocks: BlockData[]) => new Map(blocks.map((b) => [b.id, b]))

/**
 * يفتح نصوص الأقسام للكتابة (‎plaintext-only‎). ‎data-slot‎ = اسم الحقل في المستند، فبنفتح اللي ليه
 * قيمة في ‎props‎ بس. بتتنادى بعد كل رسمة لأن React ممكن يعيد بناء العقدة.
 */
export function markEditable(blocks: BlockData[], root: ParentNode = document) {
  const map = byId(blocks)
  root.querySelectorAll<HTMLElement>('[data-block]').forEach((section) => {
    const block = map.get(section.getAttribute('data-block') ?? '')
    section.querySelectorAll<HTMLElement>('[data-slot]').forEach((node) => {
      if (node.closest('[data-block]') !== section) return
      const key = node.getAttribute('data-slot') ?? ''
      const editable = !!block && !block.locked && key in block.props
      if (editable) {
        node.setAttribute('contenteditable', 'plaintext-only')
        node.setAttribute('data-lb-text', '1')
      } else if (node.hasAttribute('data-lb-text')) {
        node.removeAttribute('contenteditable')
        node.removeAttribute('data-lb-text')
      }
    })
  })
}

/** هل المستخدم بيكتب في نص دلوقتي؟ (ساعتها الرد الجاي من السيرفر بيتأجّل). */
export const editingNode = (): HTMLElement | null => {
  const active = document.activeElement
  return active instanceof HTMLElement ? active.closest<HTMLElement>('[data-lb-text]') : null
}

/**
 * نص اتكتب في خانة باللوحة → يظهر في المعاينة في نفس اللحظة من غير سيرفر. بنلمس بس العقدة النصية
 * البسيطة؛ HTML أو فاضي أو عقدة مش موجودة = ‎false‎ ورد السيرفر بعد وقفة الكتابة بيصحّحه.
 */
export function patchText(id: string, key: string, value: string, root: ParentNode = document): boolean {
  if (!value.trim() || /[<>]|&[#\w]+;/.test(value)) return false
  const section = Array.from(root.querySelectorAll('[data-block]')).find((n) => n.getAttribute('data-block') === id)
  if (!section) return false
  for (const node of section.querySelectorAll<HTMLElement>('[data-slot]')) {
    if (node.getAttribute('data-slot') !== key || node.closest('[data-block]') !== section) continue
    if (NON_TEXT.test(node.tagName) || node.childElementCount) return false
    if (node === document.activeElement) return true // بيكتب فيها هو — مانلمسهاش
    if (node.textContent !== value) node.textContent = value
    return true
  }
  return false
}

// ---------------------------------------------------------------- تفويض الأحداث
interface Options {
  payload: () => PreviewPayload | null
  send: (message: FromFrame) => void
}

interface Drag {
  node: HTMLElement
  id: string
  slot: string
  x0: number
  y0: number
  dx0: number
  dy0: number
  unit: number
  moved: boolean
  pointerId: number
  wasEditable: boolean
  dx: number
  dy: number
  /** وحدة الإزاحة: px لعناصر القالب المستورد، cqw للباقي */
  unit_: 'px' | 'cqw'
  swap: HTMLElement | null
}

const stageWidth = () => document.querySelector('.lb-stage')?.getBoundingClientRect().width || document.documentElement.clientWidth || 1

function clearGuides() {
  document.querySelectorAll('.lb-guide, .lb-drag-badge').forEach((n) => n.remove())
}

function showGuides(node: HTMLElement, math: DragMath, suffix: string) {
  clearGuides()
  const r = node.getBoundingClientRect()
  const add = (className: string, style: Partial<CSSStyleDeclaration>, text = '') => {
    const el = document.createElement('div')
    el.className = className
    Object.assign(el.style, style)
    el.textContent = text
    document.body.appendChild(el)
  }
  if (math.snapX) add('lb-guide lb-guide--v', { left: `${Math.round(r.left + r.width / 2)}px` })
  if (math.snapY) add('lb-guide lb-guide--h', { top: `${Math.round(r.top + r.height / 2)}px` })
  add(
    'lb-drag-badge',
    { left: `${Math.round(r.left + r.width / 2)}px`, top: `${Math.max(6, Math.round(r.top - 30))}px`, transform: 'translateX(-50%)' },
    `${math.dx.toFixed(1)}${suffix} , ${math.dy.toFixed(1)}${suffix}`,
  )
}

/**
 * صورة تانية في نفس القسم تحت الماوس — لو سبت صورة **فوق** صورة، النية واضحة إنك عايز تبدّلهم مش تزحزح.
 * شرطين عشان ما يحصلش تبديل بالغلط والصور في شبكة جنب بعض: الهدف ‎<img>‎ مرقّم في نفس القسم،
 * والماوس جوّه الـ٦٠٪ الوسطانية منه. الهدف بيتعلّم بإطار مقطّع (‎lb-el-swap‎) قبل ما تسيب.
 */
export function swapCandidate(node: HTMLElement, x: number, y: number): HTMLElement | null {
  if (node.tagName !== 'IMG' || typeof document.elementsFromPoint !== 'function') return null
  const holder = node.closest('[data-block]')
  for (const t of document.elementsFromPoint(x, y)) {
    if (t === node || t.tagName !== 'IMG' || !t.getAttribute('data-move') || t.closest('[data-block]') !== holder) continue
    const r = t.getBoundingClientRect()
    const mx = (r.width * (1 - SWAP_INNER)) / 2
    const my = (r.height * (1 - SWAP_INNER)) / 2
    if (x < r.left + mx || x > r.right - mx || y < r.top + my || y > r.bottom - my) continue
    return t as HTMLElement
  }
  return null
}

/** يبدّل مصدر صورتين (‎src‎ و‎srcset‎ — الأخير بيكسب على الأول فلازم يتبدّل معاه). */
export function swapImages(a: Element, b: Element) {
  const read = (n: Element) => ({ src: n.getAttribute('src'), srcset: n.getAttribute('srcset') })
  const write = (n: Element, v: { src: string | null; srcset: string | null }) => {
    if (v.src) n.setAttribute('src', v.src)
    else n.removeAttribute('src')
    if (v.srcset) n.setAttribute('srcset', v.srcset)
    else n.removeAttribute('srcset')
  }
  const first = read(a)
  write(a, read(b))
  write(b, first)
}

/** أسلاك السحب اللي اتسابت لسه بتستنى رد السيرفر: العقدة ← وقت الإفلات. */
const dropped = new WeakMap<HTMLElement, number>()
/** أقصى مدة نسيب فيها الإزاحة المؤقتة لحد ما الرسمة الجاية تحمل الإزاحة الجديدة (لو السيرفر اتأخر نشيلها برضه). */
export const DROP_HOLD_MS = 2500

const dropVars = (node: HTMLElement) => {
  node.style.removeProperty('--dx')
  node.style.removeProperty('--dy')
  dropped.delete(node)
}

/**
 * يشيل الإزاحة المؤقتة اللي السحب كتبها على العقدة — الإزاحة الدايمة جاية من ستايل ‎layout‎ في الرأس.
 * ‎blocks‎ (من الرسمة): عنصر لسه مستني إزاحته الجديدة (اتسحب من أقل من ثانيتين ونص والرسمة دي لسه قديمة)
 * بنسيب إزاحته المؤقتة عشان ما يرجعش لمكانه القديم ثم يقفز تاني لما الرد يوصل. من غيرها: بيشيل كله.
 */
export function clearDragVars(root: ParentNode = document, blocks?: BlockData[]) {
  root.querySelectorAll<HTMLElement>('[data-move]').forEach((node) => {
    const dx = node.style.getPropertyValue('--dx')
    const dy = node.style.getPropertyValue('--dy')
    if (!dx && !dy) return
    const at = dropped.get(node)
    if (blocks && at && Date.now() - at < DROP_HOLD_MS) {
      const id = node.closest('[data-block]')?.getAttribute('data-block')
      const pos = blocks.find((b) => b.id === id)?.layout?.[node.getAttribute('data-move') ?? '']
      if ((parseFloat(dx) || 0) !== (pos?.dx ?? 0) || (parseFloat(dy) || 0) !== (pos?.dy ?? 0)) return
    }
    dropVars(node)
  })
}

/** يربط الكتابة والسحب على صفحة الإطار. بيرجّع دالة الفك. */
export function installInteractions({ payload, send }: Options): () => void {
  const translated = () => {
    const p = payload()
    return !!p && p.lang !== p.baseLang
  }
  const textNode = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-lb-text]') : null
  const blockOf = (node: Element) => node.closest<HTMLElement>('[data-block]')
  let drag: Drag | null = null

  // ---- الكتابة
  const onFocusIn = (e: FocusEvent) => {
    const node = textNode(e.target)
    if (!node) return
    node.style.boxShadow = '0 0 0 2px var(--accent)'
    node.style.outline = 'none'
    const id = blockOf(node)?.getAttribute('data-block')
    if (id) send({ type: 'lb-editor:select', id })
  }
  const onFocusOut = (e: FocusEvent) => {
    const node = textNode(e.target)
    if (node) node.style.boxShadow = ''
  }
  // الكتابة من المعاينة المترجَمة كانت هتكتب الترجمة مكان النص الأصلي
  const onBeforeInput = (e: InputEvent) => {
    if (!textNode(e.target) || !translated()) return
    e.preventDefault()
    send({ type: 'lb-editor:refused' })
  }
  const onInput = (e: Event) => {
    const node = textNode(e.target)
    if (!node || translated()) return
    const id = blockOf(node)?.getAttribute('data-block')
    const key = node.getAttribute('data-slot')
    if (id && key) send({ type: 'lb-editor:text', id, key, value: node.textContent ?? '' })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && textNode(e.target)) {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
    } else if (e.key === 'Escape' && drag) {
      e.preventDefault()
      finish(true)
    }
  }

  // ---- السحب
  function movableAt(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    // الكانفس سطح رسم لكود المصمّم و‎[data-no-drag]‎ لأي عنصر تفاعلي — الضغطة بتروح له مش للسحب.
    // عناصر فوق القسم وعناصر الافتتاحية ليها سحبها (extraDrags)؛ الاستثناء: عنصر مرقّم (‎ce-N‎) جوّه كود الافتتاحية بيتسحب هنا بالبكسل
    if (target.closest('canvas, [data-no-drag], [data-section-text]')) return null
    if (target.closest('.lb-intro') && !target.closest('.lb-intro-extra [data-move]')) return null
    const node = target.closest<HTMLElement>('[data-move]')
    if (!node) return null
    // خانات البكسل (‎el-N‎ و‎ce-N‎ و‎code‎) مالهاش معنى غير جوّه قسم مستورد أو صندوق كود
    return isPxSlot(node.getAttribute('data-move')) && !node.closest('.lb-custom, .lb-extra-html, .lb-intro-extra') ? null : node
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag) return
    const node = movableAt(e.target)
    if (!node) return
    // كود الافتتاحية مش جوّه قسم: بلوكه الوهمي ‎__intro‎ وإزاحاته (بكسل) بتتقرا من الـCSS المحسوب لأنها مش في حمولة الأقسام
    const intro = !!node.closest('.lb-intro-extra')
    const id = intro ? INTRO_ID : blockOf(node)?.getAttribute('data-block')
    const slot = node.getAttribute('data-move')
    if (!id || !slot) return
    const block = intro ? null : payload()?.blocks.find((b) => b.id === id)
    if (!intro && (!block || block.locked)) return
    // بيكتب في العنصر ده دلوقتي؟ سيبه (تحريك المؤشر جوّه النص مش سحب)
    if (node === document.activeElement || (node.isContentEditable && node.contains(document.activeElement))) return
    const style = intro ? getComputedStyle(node) : null
    const pos = block
      ? block.layout?.[slot]
      : { dx: parseFloat(style?.getPropertyValue('--dx') ?? '') || 0, dy: parseFloat(style?.getPropertyValue('--dy') ?? '') || 0 }
    drag = {
      node, id, slot,
      x0: e.clientX, y0: e.clientY,
      dx0: pos?.dx ?? 0, dy0: pos?.dy ?? 0,
      unit: isPxSlot(slot) ? 1 : stageWidth() / 100,
      unit_: slotUnit(slot),
      swap: null,
      moved: false, pointerId: e.pointerId,
      // الأقسام العادية نصوصها قابلة للكتابة دايماً (contenteditable)، لكن وحدات نص القسم المستورد بتتفتح للكتابة بضغطتين بس —
      // لو رجّعناها قابلة للكتابة بعد السحب: ‎plaintext-only‎ بيفرض ‎white-space: pre-wrap‎ فمسافات الـHTML الأصلية بتبان أسطر فاضية والعنوان يطول ويقفز
      wasEditable: node.getAttribute('contenteditable') === 'plaintext-only',
      dx: pos?.dx ?? 0, dy: pos?.dy ?? 0,
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return
    const mx = e.clientX - drag.x0
    const my = e.clientY - drag.y0
    if (!drag.moved) {
      if (Math.abs(mx) < THRESHOLD && Math.abs(my) < THRESHOLD) return
      drag.moved = true
      try {
        drag.node.setPointerCapture(e.pointerId)
      } catch {
        /* مش حرج */
      }
      drag.node.classList.add('lb-dragging')
      drag.node.removeAttribute('contenteditable') // مفيش كتابة أثناء السحب
      window.getSelection()?.removeAllRanges()
      send({ type: 'lb-editor:select', id: drag.id })
    }
    e.preventDefault()
    const math = dragOffset(
      { dx0: drag.dx0, dy0: drag.dy0 },
      { x: mx, y: my },
      drag.unit,
      e.shiftKey,
      drag.unit_ === 'px' ? SNAP_PX : SNAP,
    )
    drag.dx = math.dx
    drag.dy = math.dy
    drag.node.style.setProperty('--dx', `${math.dx}${drag.unit_}`)
    drag.node.style.setProperty('--dy', `${math.dy}${drag.unit_}`)
    showGuides(drag.node, math, drag.unit_ === 'px' ? 'px' : '%')
    const over = swapCandidate(drag.node, e.clientX, e.clientY)
    if (over !== drag.swap) {
      drag.swap?.classList.remove('lb-el-swap')
      over?.classList.add('lb-el-swap')
      drag.swap = over
    }
  }

  function finish(cancel: boolean) {
    if (!drag) return
    const d = drag
    drag = null
    try {
      d.node.releasePointerCapture(d.pointerId)
    } catch {
      /* مش حرج */
    }
    clearGuides()
    d.node.classList.remove('lb-dragging')
    d.swap?.classList.remove('lb-el-swap')
    if (!d.moved) return
    if (d.wasEditable) {
      d.node.setAttribute('contenteditable', 'plaintext-only')
    }
    // سبت صورة فوق صورة = تبديل مش تحريك: الإزاحة ترجع، والمصدرين يتبدّلوا، والـHTML يتحفظ
    if (!cancel && d.swap) {
      d.node.style.removeProperty('--dx')
      d.node.style.removeProperty('--dy')
      swapImages(d.node, d.swap)
      const root = d.node.closest('.lb-custom')
      if (root) commitHtml(root, send)
      else commitSwap(d.node, d.swap, send)
      return
    }
    if (cancel || (d.dx === d.dx0 && d.dy === d.dy0)) {
      // رجّع الإزاحة الأصلية (الستايل الدايم هو اللي بيرسمها)
      d.node.style.removeProperty('--dx')
      d.node.style.removeProperty('--dy')
      return
    }
    // آخر إزاحة تتكتب تاني: رد تحديد القسم ممكن يوصل للإطار وقت الإفلات ويمسح الإزاحة المؤقتة (فالعنصر كان بيرجع لمكانه القديم)
    d.node.style.setProperty('--dx', `${d.dx}${d.unit_}`)
    d.node.style.setProperty('--dy', `${d.dy}${d.unit_}`)
    send({ type: 'lb-editor:layout', id: d.id, slot: d.slot, dx: d.dx, dy: d.dy })
    // الإزاحة الجديدة تفضل على العقدة لحد ما الرسمة الجاية تحملها (clearDragVars) — أو لحد ما المهلة تخلص
    dropped.set(d.node, Date.now())
    setTimeout(() => dropped.has(d.node) && dropVars(d.node), DROP_HOLD_MS)
  }

  const onPointerUp = () => finish(false)
  const onPointerCancel = () => finish(true)

  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('beforeinput', onBeforeInput)
  document.addEventListener('input', onInput)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)
  return () => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('beforeinput', onBeforeInput)
    document.removeEventListener('input', onInput)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerCancel)
    clearGuides()
  }
}
