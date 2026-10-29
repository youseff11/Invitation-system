import { findSlot, out, parse } from './dom'
import { applyNodeEdit, readNode, type NodeEdit, type NodeInfo } from './nodeEdit'
import { cleanCopy } from './serialize'
import { slotKind, type SourceKind } from './source'
import { isTextual } from './units'

/**
 * عمليات الهيكل على عناصر القسم المستورد (S3): نسخ، لصق، تكرار، حذف، إضافة نص/صورة، الأب، الطبقات.
 *
 * كلها دوال نقية على نص ‎props.html‎ المحفوظ (مش على DOM المعاينة): بنحلّله في مستند خامل (‎DOMParser‎ — مفيش
 * تحميل صور ولا سكربتات)، بنلاقي العنصر برقمه (‎data-move‎)، بنعدّل، وبنرجّع النص الجديد. كده مفيش كتابة راجعة
 * من المعاينة (خصوصاً المترجَمة) والعمليات كلها قابلة للاختبار. العنصر الجديد بياخد رقم ‎el-N‎ حر على طول،
 * وباقي أرقام اللي جواه بتتضاف في الإطار بعد الرسمة (‎numberElements‎).
 */

/** نتيجة عملية: النص الجديد، العنصر اللي يتحدّد بعدها، وأرقام العناصر اللي اتشالت (مواضعها تتمسح من ‎layout‎) */
export interface Edit {
  html: string
  select: string | null
  dropped: string[]
}

export type AddKind = 'text' | 'image'

export type LayerKind = 'text' | 'image' | 'video' | 'map' | 'element'

export interface Layer {
  slot: string
  kind: LayerKind
  /** مفتاح اسم النوع (‎heading‎، ‎group‎…) لما الـ‎kind‎ مش كفاية */
  name: string
  text: string
}

export interface ElementInfo {
  /** وحدة نص: بتتكتب بضغطتين ومايتحطش جواها عناصر */
  textual: boolean
  /** ينفع يتحط جواه عنصر (مش وحدة نص ولا صورة/فيديو…) */
  canContain: boolean
}

/** وسوم مابتقبلش محتوى مرئي جواها — الإضافة واللصق بيروحوا بعدها */
const CANNOT_CONTAIN = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'BR', 'HR', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'CANVAS', 'SVG'])

const NAMES: Record<string, string> = {
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
  P: 'paragraph', SPAN: 'text', STRONG: 'text', EM: 'text', SMALL: 'text',
  A: 'link', IMG: 'image', FIGURE: 'image', LI: 'listItem', UL: 'list', OL: 'list',
  DIV: 'group', SECTION: 'group', HEADER: 'header', FOOTER: 'footer', BLOCKQUOTE: 'quote',
  TABLE: 'table', TD: 'cell', BUTTON: 'button',
}

/** مفتاح اسم الوسم (‎heading‎، ‎group‎…) للعرض — ‎element‎ لو مش معروف. */
export const nameOf = (tag: string) => NAMES[tag.toUpperCase()] ?? 'element'

const MAP_URL = /google\.com\/maps|maps\.googleapis\.com/i
const LABEL_MAX = 42

const tagOf = (n: Element) => n.tagName.toUpperCase()

/** المستند الخامل لعنصر: صندوق كود لو رقمه ‎ce-N‎ (أو ‎code‎)، وإلا قسم مستورد. */
const parseFor = (html: string, slot: string) => parse(html, slotKind(slot))

/** أول ‎el-N‎ حر (نفس منطق ‎numberElements‎ عشان الأرقام ماتتضاربش). */
function freeSlot(root: Element): string {
  // عناصر صندوق الكود ‎ce-N‎ وعناصر القالب المستورد ‎el-N‎ (جدول إزاحات واحد لكل بلوك فالبادئتين لازم يفرّقوا)
  const prefix = root.classList.contains('lb-extra-html') ? 'ce-' : 'el-'
  const used = new Set(Array.from(root.querySelectorAll('[data-move]')).map((n) => n.getAttribute('data-move')))
  let next = 1
  while (used.has(`${prefix}${next}`)) next++
  return `${prefix}${next}`
}

const slotsIn = (node: Element) =>
  [node, ...Array.from(node.querySelectorAll('[data-move]'))].flatMap((n) => n.getAttribute('data-move') ?? [])

/** وحدات النص (أعلى عنصر نصه بس) — زي ‎data-lb-text‎ في الإطار، من غير شرط الحجم (مفيش layout هنا). */
function textUnits(root: Element): Set<Element> {
  const units = new Set<Element>()
  for (const n of Array.from(root.querySelectorAll('*'))) {
    if (!isTextual(n)) continue
    let covered = false
    for (let up = n.parentElement; up && up !== root; up = up.parentElement) {
      if (units.has(up)) {
        covered = true
        break
      }
    }
    if (!covered) units.add(n)
  }
  return units
}

const canHold = (node: Element, units: Set<Element>) => !units.has(node) && !CANNOT_CONTAIN.has(tagOf(node))

/** فين يتحط العنصر الجديد: جوّه الحاوية لو ينفع (واللي مطلوب جوّه)، وإلا بعدها. */
function place(node: Element, fresh: Element, inside: boolean, units: Set<Element>) {
  if (inside && canHold(node, units)) node.appendChild(fresh)
  else node.insertAdjacentElement('afterend', fresh)
}

/** العنصر موجود في النص؟ (بعد تراجع/إعادة ممكن يكون رقمه راح). */
export function hasSlot(html: string, slot: string): boolean {
  return !!findSlot(parseFor(html, slot), slot)
}

export function inspect(html: string, slot: string): ElementInfo | null {
  const root = parseFor(html, slot)
  const node = findSlot(root, slot)
  if (!node) return null
  const units = textUnits(root)
  return { textual: units.has(node), canContain: canHold(node, units) }
}

/** نسخة نضيفة من العنصر (من غير ترقيم ولا علاماتنا) — بتتخزّن في الحافظة. */
export function copyOf(html: string, slot: string): string | null {
  const node = findSlot(parseFor(html, slot), slot)
  return node ? cleanCopy(node).outerHTML : null
}

function fromClip(root: Element, clip: string): Element | null {
  const holder = root.ownerDocument.createElement('div')
  holder.innerHTML = clip
  return holder.firstElementChild
}

/** لصق الحافظة بعد العنصر (أو جوّاه لو ينفع). العنصر الملصوق بياخد رقم جديد ويتحدّد. */
export function pasteOf(html: string, slot: string, clip: string, inside = false): Edit | null {
  const root = parseFor(html, slot)
  const node = findSlot(root, slot)
  const fresh = node && fromClip(root, clip)
  if (!node || !fresh) return null
  const added = freeSlot(root)
  fresh.setAttribute('data-move', added)
  place(node, fresh, inside, textUnits(root))
  return { html: out(root), select: added, dropped: [] }
}

/** تكرار: نسخة بعد العنصر نفسه (من غير ما نلمس الحافظة). */
export function duplicateOf(html: string, slot: string): Edit | null {
  const clip = copyOf(html, slot)
  return clip ? pasteOf(html, slot, clip, false) : null
}

/** حذف العنصر بكل اللي جواه — أرقامهم كلها بترجع في ‎dropped‎ عشان مواضعهم تتمسح. */
export function deleteOf(html: string, slot: string): Edit | null {
  const root = parseFor(html, slot)
  const node = findSlot(root, slot)
  if (!node) return null
  const dropped = slotsIn(node)
  node.remove()
  return { html: out(root), select: null, dropped }
}

/** إضافة نص جديد أو صورة جوّه العنصر أو بعده. ‎value‎: نص الفقرة، أو رابط الصورة. */
export function addOf(html: string, slot: string, kind: AddKind, value: string): Edit | null {
  const root = parseFor(html, slot)
  const node = findSlot(root, slot)
  if (!node) return null
  const doc = root.ownerDocument
  let fresh: HTMLElement
  if (kind === 'image') {
    fresh = doc.createElement('img')
    fresh.setAttribute('src', value)
    fresh.setAttribute('alt', '')
    fresh.setAttribute('style', 'max-width:100%;height:auto;display:block')
  } else {
    fresh = doc.createElement('p')
    fresh.textContent = value
  }
  const added = freeSlot(root)
  fresh.setAttribute('data-move', added)
  place(node, fresh, true, textUnits(root))
  return { html: out(root), select: added, dropped: [] }
}

/** حالة العنصر للوحة (نص، تنسيق مضمّن، مصدر الصورة…) من ‎props.html‎. */
export function nodeInfo(html: string, slot: string): NodeInfo | null {
  return readNode(parseFor(html, slot), slot)
}

/** تعديل خاصية/نص/صورة عنصر (لوحة العنصر): نفس ‎applyNodeEdit‎ اللي بتتطبّق بيه على المعاينة الحية. العنصر يفضل محدَّد. */
export function editOf(html: string, slot: string, edit: NodeEdit): Edit | null {
  const root = parseFor(html, slot)
  if (!applyNodeEdit(root, slot, edit)) return null
  return { html: out(root), select: slot, dropped: [] }
}

/** رقم أقرب أب مرقّم، أو ‎null‎ لو ده أعلى عنصر في القسم. */
export function parentOf(html: string, slot: string): string | null {
  const root = parseFor(html, slot)
  const node = findSlot(root, slot)
  for (let up = node?.parentElement; up && up !== root; up = up.parentElement) {
    const move = up.getAttribute('data-move')
    if (move) return move
  }
  return null
}

/**
 * طبقات القسم: العناصر المرقّمة اللي هي «حاجة مرئية فعلاً» — نص، أو عنصر ماجواهوش نص/صورة/فيديو/iframe
 * (Tilda بيحط الرقم على الحاوية وعلى اللي جواها، فالحاوية اللي فيها حاجة بتتخطّى). نفس قاعدة القديم.
 */
export function layersOf(html: string, kind: SourceKind = 'html'): Layer[] {
  const root = parse(html, kind)
  const units = textUnits(root)
  const layers: Layer[] = []
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-move]'))) {
    const slot = node.getAttribute('data-move')
    if (!slot) continue
    const isText = units.has(node)
    const childVisual =
      !!node.querySelector('img, video, iframe') || Array.from(units).some((u) => u !== node && node.contains(u))
    if (!isText && childVisual) continue

    const tag = tagOf(node)
    const frame = tag === 'IFRAME' ? node : node.querySelector('iframe')
    let kind: LayerKind = isText ? 'text' : 'element'
    if (frame && MAP_URL.test(frame.getAttribute('src') ?? '')) kind = 'map'
    else if (tag === 'IMG' || node.querySelector('img')) kind = 'image'
    else if (tag === 'VIDEO' || node.querySelector('video')) kind = 'video'

    let text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length > LABEL_MAX) text = `${text.slice(0, LABEL_MAX)}…`
    layers.push({ slot, kind, name: nameOf(tag), text })
  }
  return layers
}
