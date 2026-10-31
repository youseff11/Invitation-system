import { findSlot } from './dom'
import { GOOGLE_MAP } from './map'
import { CODE_ROOTS, isImportedCountdownPart, isTextual } from './units'

/**
 * تعديلات «لوحة العنصر» (S4): نص، تنسيق (style مضمّن)، صورة، فيديو، خريطة. نفس الدالة (‎applyNodeEdit‎) بتتطبّق مرتين:
 * على نص ‎props.html‎ في الصفحة الأم (المصدر اللي بيتحفظ)، وعلى DOM المعاينة الحي (عشان التغيير يبان لحظياً
 * قبل ما رد السيرفر يوصل) — فمفيش كتابة راجعة من المعاينة أبداً. القيمة الفاضية = شيل الخاصية.
 */
export type NodeEdit =
  /** ‎style‎ على «عقدة التنسيق»: الصورة/الفيديو لو فيه، وإلا وحدة النص اللي جوّه، وإلا العنصر نفسه */
  | { kind: 'style'; prop: string; value: string }
  /** ‎style‎ على العنصر المحدَّد نفسه (الإخفاء ‎display:none‎) */
  | { kind: 'self'; prop: string; value: string }
  | { kind: 'text'; value: string }
  /** محتوى العنصر نفسه (‎innerHTML‎) — كتابة وحدة نص في صندوق الكود من المعاينة (بتحافظ على الوسوم السطرية اللي فيها) */
  | { kind: 'inner'; html: string }
  /** خصائص الصورة (أو العنصر نفسه): قيمة أو ‎null‎ للشيل — تبديل صورتين بالسحب بيبدّل ‎src‎ و‎srcset‎ مع بعض */
  | { kind: 'attrs'; values: Record<string, string | null> }
  /** مصدر الصورة: ‎src‎ جديد ومعاه شيل ‎srcset‎ (بيكسب على ‎src‎) */
  | { kind: 'src'; value: string }
  /** مصدر الفيديو: ‎src‎ + ‎preload‎، وكل ‎<source>‎ جواه بياخد الرابط الجديد (وإلا بيكسب على ‎src‎) */
  | { kind: 'video-src'; value: string }
  /** رابط تضمين الخريطة (جاهز من ‎mapEmbedUrl‎) */
  | { kind: 'map-src'; value: string }
  /** عرض/ارتفاع الخريطة بالبكسل (قالب Tilda بيقراهم من سمات ‎data-field-*‎ فبنكتبهم كلهم + ستايل) */
  | { kind: 'map-size'; prop: 'width' | 'height'; value: number }

const tagOf = (n: Element) => n.tagName.toUpperCase()

export const imageIn = (node: Element): Element | null => (tagOf(node) === 'IMG' ? node : node.querySelector('img'))
export const videoIn = (node: Element): Element | null => (tagOf(node) === 'VIDEO' ? node : node.querySelector('video'))

/** ‎<iframe>‎ الخريطة: العنصر نفسه أو اللي جواه، لو ده رابط جوجل (أو العنصر معلّم ‎data-map="1"‎). */
export function mapFrameIn(node: Element): Element | null {
  const frame = tagOf(node) === 'IFRAME' ? node : node.querySelector('iframe')
  return frame && (GOOGLE_MAP.test(frame.getAttribute('src') ?? '') || node.getAttribute('data-map') === '1') ? frame : null
}

/** صندوق الخريطة: عنصر Tilda (‎.tn-elem‎) اللي حاويها، وإلا العنصر نفسه. */
const mapBoxOf = (node: Element): Element => node.closest('.tn-elem') ?? node

const NOT_TEXT_LEAF = new Set(['IMG', 'VIDEO', 'IFRAME', 'SVG', 'CANVAS', 'PICTURE', 'SOURCE', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'BR', 'HR'])

/**
 * عنصر فاضي جوّه صندوق كود (مفيش أبناء ولا نص — النص اتمسح أو سكربت المصمّم هو اللي بيملاه): مش «وحدة نص» لأن وحدة النص
 * لازم فيها كلام، لكن لو اتحدّد لازم تفضل خانة النص قدّامه وإلا مفيش طريق يرجّع يكتب فيه.
 */
const isEmptyCodeLeaf = (node: Element): boolean =>
  !node.matches(CODE_ROOTS) &&
  !!node.closest(CODE_ROOTS) &&
  node.children.length === 0 &&
  !(node.textContent ?? '').trim() &&
  !NOT_TEXT_LEAF.has(tagOf(node))

/** وحدة النص اللي العنصر هو نفسه أو أول واحدة جواه (من غير حد المقاس — مفيش layout في المستند الخامل). */
export function textUnitIn(node: Element): Element | null {
  if (isTextual(node) || isEmptyCodeLeaf(node)) return node
  return Array.from(node.querySelectorAll('*')).find(isTextual) ?? null
}

/** العقدة اللي بتتكتب عليها الخصائص: صورة ثم فيديو ثم وحدة نص ثم العنصر نفسه (ترتيب القديم). */
export function styleTarget(node: Element): Element {
  return imageIn(node) ?? videoIn(node) ?? textUnitIn(node) ?? node
}

function setProp(node: Element, prop: string, value: string, priority = '') {
  const style = (node as HTMLElement).style
  if (!style) return
  if (value) style.setProperty(prop, value, priority)
  else style.removeProperty(prop)
  if (!node.getAttribute('style')) node.removeAttribute('style') // ‎style=""‎ فاضي مالوش لازمة
}

function resizeMap(node: Element, frame: Element, prop: 'width' | 'height', value: number) {
  const size = String(Math.max(120, Math.min(900, Math.round(value) || 0)))
  const box = mapBoxOf(node)
  box.setAttribute(`data-field-${prop}-value`, size)
  // علامة صريحة إن المقاس ده اختاره المستخدم؛ المحرك بيحافظ عليه
  box.setAttribute(`data-lb-map-${prop}`, size)
  const responsive = new RegExp(`^data-field-${prop}-res-[^-]+-value$`, 'i')
  for (const attr of Array.from(box.attributes)) if (responsive.test(attr.name)) box.setAttribute(attr.name, size)
  setProp(box, prop, `${size}px`, 'important')
  if (frame !== box) setProp(frame, prop, '100%', 'important')
}

/** بيطبّق تعديل على العنصر برقمه جوّه ‎root‎. بيرجّع ‎false‎ لو العنصر مش موجود أو مالوش الجزء المطلوب. */
export function applyNodeEdit(root: Element, slot: string, edit: NodeEdit): boolean {
  const node = findSlot(root, slot)
  if (!node) return false
  switch (edit.kind) {
    case 'style':
      setProp(styleTarget(node), edit.prop, edit.value)
      return true
    case 'self':
      setProp(node, edit.prop, edit.value)
      return true
    case 'text': {
      const unit = textUnitIn(node)
      if (!unit) return false
      // السطر الجديد = ‎<br>‎ (نفس اللي ‎plainText‎ بيقراه) — ‎\n‎ خام كان بيتلم لمسافة فالـEnter مايظهرش
      const doc = unit.ownerDocument
      unit.replaceChildren(
        ...edit.value.split('\n').flatMap((line, at) => {
          const text = doc.createTextNode(line)
          return at ? [doc.createElement('br'), text] : [text]
        }),
      )
      return true
    }
    case 'inner':
      node.innerHTML = edit.html
      return true
    case 'attrs': {
      const target = imageIn(node) ?? node
      for (const [name, value] of Object.entries(edit.values)) {
        if (value === null) target.removeAttribute(name)
        else target.setAttribute(name, value)
      }
      return true
    }
    case 'src': {
      const image = imageIn(node)
      if (!image) return false
      image.setAttribute('src', edit.value)
      image.removeAttribute('srcset')
      return true
    }
    case 'video-src': {
      const video = videoIn(node)
      if (!video || !edit.value) return false
      video.setAttribute('src', edit.value)
      video.setAttribute('preload', 'auto')
      video.removeAttribute('data-src')
      video.querySelectorAll('source').forEach((source) => {
        source.setAttribute('src', edit.value)
        source.removeAttribute('srcset')
      })
      return true
    }
    case 'map-src': {
      const frame = mapFrameIn(node)
      if (!frame || !edit.value) return false
      frame.setAttribute('src', edit.value)
      return true
    }
    case 'map-size': {
      const frame = mapFrameIn(node)
      if (!frame) return false
      resizeMap(node, frame, edit.prop, edit.value)
      return true
    }
  }
}

/** خصائص التنسيق اللي اللوحة بتقراها من العقدة. */
export const STYLE_PROPS = [
  'font-family', 'font-size', 'font-weight', 'text-align', 'color', 'background-color',
  'letter-spacing', 'line-height', 'width', 'border-radius', 'opacity',
] as const
export type StyleProp = (typeof STYLE_PROPS)[number]

export type NodeKind = 'image' | 'video' | 'map' | 'text' | 'shape'

export interface NodeInfo {
  tag: string
  /** أول كلاس من القالب (من غير علاماتنا) — بيظهر جنب الاسم */
  className: string
  kind: NodeKind
  /** نص وحدة النص (‎<br>‎ بقت سطر جديد) — ‎null‎ لو مفيش وحدة نص */
  text: string | null
  /** مصدر الصورة — ‎null‎ لو مش صورة */
  src: string | null
  videoSrc: string | null
  /** رابط تضمين الخريطة ومقاسها بالبكسل (الافتراضي ٣٣٥) — ‎null‎ لو مش خريطة */
  map: { src: string; width: number; height: number } | null
  /** جزء من عدّاد القالب المستورد (موعده واتجاهه إعدادات القسم) */
  countdown: boolean
  hidden: boolean
  /** القيم المضمّنة على عقدة التنسيق (فاضية = مفيش قيمة مضمّنة) */
  styles: Record<StyleProp, string>
}

const OWN_CLASSES = new Set(['lb-el-picked', 'lb-el-typing', 'lb-dragging', 'lb-el-swap'])
/** علامة سطر جديد مؤقتة (حرف من المنطقة الخاصة) — مابتظهرش في أي نص حقيقي */
const BREAK = String.fromCharCode(0xe000)
const MAP_DEFAULT = 335

/** نص وحدة النص زي ما بيظهر: ‎<br>‎ سطر جديد، والوسوم تتشال، والمسافات/الأسطر اللي من تنسيق الـHTML بتتلم. */
function plainText(unit: Element): string {
  const clone = unit.cloneNode(true) as Element
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(BREAK))
  return collapse(clone.textContent ?? '')
}

const collapse = (raw: string) => raw.replace(/\s+/g, ' ').trim().replace(new RegExp(` ?${BREAK} ?`, 'g'), '\n')

/** النص اللي هيرجع من ‎readNode‎ لو كتبنا ‎value‎ — اللوحة بتقارن بيه عشان تعرف رجع صدى كتابتها ولا تغيّر من برّه. */
export const normalizeText = (value: string) => collapse(value.split('\n').join(BREAK))

function mapSize(node: Element, prop: 'width' | 'height'): number {
  const box = mapBoxOf(node)
  return parseFloat(box.getAttribute(`data-lb-map-${prop}`) ?? box.getAttribute(`data-field-${prop}-value`) ?? '') || MAP_DEFAULT
}

/** يقرا حالة العنصر للوحة من ‎props.html‎ المحلّل (مش من المعاينة). */
export function readNode(root: Element, slot: string): NodeInfo | null {
  const node = findSlot(root, slot)
  if (!node) return null
  const image = imageIn(node)
  const video = videoIn(node)
  const frame = mapFrameIn(node)
  const unit = textUnitIn(node)
  const target = styleTarget(node) as HTMLElement
  const styles = Object.fromEntries(STYLE_PROPS.map((prop) => [prop, target.style?.getPropertyValue(prop) ?? ''])) as Record<
    StyleProp,
    string
  >
  const className = (node.getAttribute('class') ?? '').split(/\s+/).find((c) => c && !OWN_CLASSES.has(c)) ?? ''
  return {
    tag: tagOf(node),
    className,
    kind: image ? 'image' : video ? 'video' : frame ? 'map' : unit ? 'text' : 'shape',
    text: unit ? plainText(unit) : null,
    src: image?.getAttribute('src') ?? null,
    videoSrc: video ? (video.getAttribute('src') ?? video.querySelector('source')?.getAttribute('src') ?? '') : null,
    map: frame ? { src: frame.getAttribute('src') ?? '', width: mapSize(node, 'width'), height: mapSize(node, 'height') } : null,
    countdown: isImportedCountdownPart(node),
    hidden: (node as HTMLElement).style?.display === 'none',
    styles,
  }
}
