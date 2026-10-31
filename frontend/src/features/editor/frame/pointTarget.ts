/** جذور العناصر المرقّمة: القسم المستورد وصناديق الكود */
const ROOTS = '.lb-custom, .lb-extra-html, .lb-intro-extra'

/**
 * مش باين للمصمّم: هو أو أي أب جوّه جذره شفاف تماماً (‎opacity: 0‎) أو مخفي (‎visibility: hidden‎).
 * المحرر بيفرض ‎pointer-events: auto‎ على كل عنصر مرقّم، فشرائح كاروسيل مخفية (شريحة نشطة واحدة والباقي
 * ‎opacity: 0‎ فوق بعض) كانت بتاخد الضغطة بدل الشريحة اللي باينة.
 */
function isGhost(el: Element): boolean {
  const root = el.closest(ROOTS)
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const style = getComputedStyle(cur)
    if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return true
    if (cur === root) break
  }
  return false
}

/**
 * هدف الضغطة: أعلى عنصر مرقّم باين تحت الماوس في نفس القسم لو الهدف الأصلي مخفي؛ لو مفيش فالهدف الأصلي
 * (أحسن من ضغطة تضيع).
 */
export function pointTarget(e: MouseEvent | PointerEvent): EventTarget | null {
  const target = e.target
  if (!(target instanceof Element) || typeof document.elementsFromPoint !== 'function') return target
  const root = target.closest(ROOTS)
  if (!root || !isGhost(target)) return target
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (el.closest(ROOTS) === root && el.closest('[data-move]') && !isGhost(el)) return el
  }
  return target
}
