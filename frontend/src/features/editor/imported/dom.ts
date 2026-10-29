/**
 * أدوات DOM الخامل المشتركة: نحلّل ‎props.html‎ في مستند ما بيحمّلش صور ولا بيشغّل سكربتات (‎DOMParser‎)،
 * ونلاقي العنصر برقمه (‎data-move‎). مفيش هنا اعتماد على أي حاجة تانية في ‎imported/‎.
 */

/**
 * مستند خامل بيتحط فيه النص كجذر ‎.lb-custom‎ (قسم مستورد — عشان ‎closest('.lb-custom')‎ في محدّدات العدّاد تشتغل)
 * أو ‎.lb-extra-html‎ (صندوق «كود متقدّم» — بيغيّر قاعدة وحدات النص).
 */
export function parse(html: string, kind: 'html' | 'code' = 'html'): HTMLElement {
  const doc = new DOMParser().parseFromString('<!doctype html><body></body>', 'text/html')
  const root = doc.createElement('div')
  root.className = kind === 'code' ? 'lb-extra-html' : 'lb-custom'
  root.innerHTML = html
  return root
}

export function findSlot(root: Element, slot: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-move]')).find((n) => n.getAttribute('data-move') === slot) ?? null
}

export const out = (root: Element) => root.innerHTML
