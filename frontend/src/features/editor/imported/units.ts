/**
 * محدّدات عناصر القسم المستورد (Tilda…) — منقولة من ‎editor.js‎ القديم (‎isTextUnit‎ وإخوتها).
 * كلها دوال على الـDOM الحي: «وحدة نص» = عنصر نصه بس (أبناؤه سطريين)، فبنفتحه للكتابة،
 * وأي عنصر ليه حجم حقيقي بياخد رقم (‎data-move="el-N"‎) ويتحدّد ويتحرّك.
 */

const TEXTY = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'A', 'LI', 'TD', 'TH', 'STRONG', 'EM', 'B', 'I', 'SMALL',
  'FIGCAPTION', 'BLOCKQUOTE', 'TIME', 'MARK',
])

// أبناء سطريين مابيمنعوش العنصر إنه يبقى «نص واحد» (‎<h1>ليلى<span>&</span>كريم</h1>‎ شكل شائع)
const INLINE = new Set(['SPAN', 'EM', 'I', 'B', 'STRONG', 'SMALL', 'U', 'S', 'MARK', 'SUP', 'SUB', 'BR', 'TIME', 'ABBR'])

const COUNTDOWN_MARK =
  /(countdown|time-block|number-wrap|section-countdown|\bcd-(?:num|days?|hours?|mins?|minutes?|secs?|seconds?)\b)/i

const MEDIA = 'img, video, iframe, input, textarea, select'

const classOf = (n: Element) => n.getAttribute('class') ?? ''
const hasText = (n: Element) => !!(n.textContent ?? '').trim()

/** جزء من عدّاد القالب المستورد (سكربته هو اللي بيكتب أرقامه — مانفتحوش للكتابة). */
export function isImportedCountdownPart(n: Element | null): boolean {
  const root = n?.closest('.lb-custom')
  if (!n || !root) return false
  for (let cur: Element | null = n; cur && cur !== root; cur = cur.parentElement) {
    if (COUNTDOWN_MARK.test(`${cur.id} ${classOf(cur)}`)) return true
  }
  return false
}

/** القسم فيه عدّاد مستورد؟ (من نص الـHTML المحفوظ — من غير DOM — عشان لوحة الخصائص تعرض إعدادات العدّاد لما يكون فيه عدّاد بس). */
export function hasCountdown(html: string): boolean {
  for (const match of html.matchAll(/\b(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (COUNTDOWN_MARK.test(match[1] ?? match[2] ?? '')) return true
  }
  return false
}

/** عنصر Tilda النصي (‎.tn-atom‎) — أبناؤه سطريين ومفيش وسايط جواه. */
export function isTildaTextUnit(n: Element): boolean {
  if (!n.classList.contains('tn-atom') || !hasText(n) || n.querySelector(MEDIA)) return false
  return Array.from(n.children).every((c) => INLINE.has(c.tagName))
}

/** وحدة نص عادية: وسم نصي، أبناؤه سطريين من غير أحفاد، وخارج العدّاد. */
export function isTextUnit(n: Element): boolean {
  if (isImportedCountdownPart(n) || !TEXTY.has(n.tagName) || !hasText(n)) return false
  return Array.from(n.children).every((c) => INLINE.has(c.tagName) && c.children.length === 0)
}

/** تسمية «.label» جوّه عدّاد مستورد (نص الأيام/الساعات…) — بتتعدّل مع إنها جزء من العدّاد. */
export function isCountdownLabel(n: Element): boolean {
  return n.classList.contains('label') && isImportedCountdownPart(n) && !n.querySelector(MEDIA)
}

/** جذور «كود متقدّم»: صندوق القسم وصندوق الافتتاحية (كود المصمّم، مش قالب مستورد). */
export const CODE_ROOTS = '.lb-extra-html, .lb-intro-extra'

const CODE_BLOCKERS = 'img,video,iframe,input,textarea,select,button,svg,canvas'
const CODE_MEDIA = new Set(['IMG', 'VIDEO', 'IFRAME', 'SVG', 'CANVAS', 'PICTURE'])

const hasOwnText = (node: Element) => Array.from(node.childNodes).some((c) => c.nodeType === 3 && (c.nodeValue ?? '').trim())

/**
 * وحدة نص جوّه كود المصمّم — أوسع من ‎isTextUnit‎ في حتة (مفيش قايمة وسوم: كود المصمّم بيكتب الأسامي في ‎<div>‎ زي ‎<h1>‎)
 * وأضيق في حتة: ‎<div class="names"><span>ليلى</span><span>كريم</span></div>‎ الأب **حاوية** وكل ‎span‎ وحدة نص،
 * إلا لو الأب نفسه فيه كلام مباشر (‎<h1>ليلى<span>&</span>كريم</h1>‎) فهو الوحدة.
 */
export function isCodeTextUnit(node: Element, box: Element): boolean {
  if (node === box || !(node.textContent ?? '').trim() || node.querySelector(CODE_BLOCKERS)) return false
  const own = hasOwnText(node)
  return Array.from(node.children).every((c) => INLINE.has(c.tagName) && (own || !(c.textContent ?? '').trim()))
}

/** وحدة نص: جوّه صندوق الكود بقاعدته الأوسع، وإلا بقواعد القالب المستورد. */
export function isTextual(n: Element): boolean {
  const box = n.closest(CODE_ROOTS)
  return box ? isCodeTextUnit(n, box) : isTextUnit(n) || isTildaTextUnit(n) || isCountdownLabel(n)
}

const big = (n: Element) => {
  const r = n.getBoundingClientRect()
  return r.width > 6 && r.height > 6
}

/**
 * عناصر صندوق الكود اللي تتحدّد وتتحرّك: الطبقة الخارجية (سحبها بيحرّك الشكل كله) والكلام والوسايط.
 * حاويات النص بتتشال. لازم تكون ليها حجم حقيقي (>٦px).
 */
export function codeMovables(root: Element): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const n of Array.from(root.children)) if (big(n)) out.push(n as HTMLElement)
  for (const n of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (out.includes(n) || !big(n)) continue
    if (CODE_MEDIA.has(n.tagName.toUpperCase()) || isCodeTextUnit(n, root)) out.push(n)
  }
  return out
}

/** العناصر اللي ينفع تتحرّك: أي حاجة ليها حجم حقيقي (>٦px) — غير ‎BR/HR‎. */
export function movableIn(root: Element): HTMLElement[] {
  if (root.matches(CODE_ROOTS)) return codeMovables(root)
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((n) => {
    if (n.tagName === 'BR' || n.tagName === 'HR') return false
    const r = n.getBoundingClientRect()
    return r.width > 6 && r.height > 6
  })
}
