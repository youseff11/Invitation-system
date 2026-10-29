/** علامات المحرر الوقتية اللي لازم تتشال قبل ما الـHTML يتحفظ (كلاسات وسمات وستايل). */
const OWN_CLASSES = ['lb-el-picked', 'lb-el-typing', 'lb-dragging', 'lb-el-swap']

/**
 * ‎props.html‎ من الـDOM بعد شيل علاماتنا: ‎contenteditable‎، ‎data-lb-*‎، كلاسات التحديد والكتابة، وستايل
 * السحب/التحديد المضمّن. الإزاحات محفوظة في ‎block.layout‎ مش في الـHTML. ‎data-move‎ بيفضل (هو الترقيم).
 */
export function serializeCustom(root: Element): string {
  const clone = root.cloneNode(true) as Element
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'))
  clone.querySelectorAll('[data-lb-edit]').forEach((n) => n.removeAttribute('data-lb-edit'))
  clone.querySelectorAll('[data-lb-text]').forEach((n) => n.removeAttribute('data-lb-text'))
  clone.querySelectorAll(`.${OWN_CLASSES.join(', .')}`).forEach((n) => {
    n.classList.remove(...OWN_CLASSES)
    if (!n.getAttribute('class')) n.removeAttribute('class')
  })
  clone.querySelectorAll<HTMLElement>('[style]').forEach((n) => {
    for (const prop of ['--dx', '--dy', 'box-shadow', 'outline']) n.style.removeProperty(prop)
    if (!n.getAttribute('style')) n.removeAttribute('style')
  })
  return clone.innerHTML
}

/** نسخة نضيفة من عنصر (للنسخ/اللصق): من غير ترقيم ولا علاماتنا — العنصر الملصوق بياخد رقم جديد. */
export function cleanCopy(node: Element): Element {
  const copy = node.cloneNode(true) as Element
  const strip = (n: Element) => {
    for (const attr of ['data-move', 'data-lb-edit', 'data-lb-text', 'contenteditable']) n.removeAttribute(attr)
    n.classList.remove(...OWN_CLASSES)
    if (!n.getAttribute('class')) n.removeAttribute('class')
  }
  strip(copy)
  copy.querySelectorAll('*').forEach(strip)
  return copy
}
