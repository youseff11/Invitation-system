import { CODE_ROOTS, isTextual, movableIn } from './units'

export interface Numbered {
  /** العناصر اللي بتتحدّد وتتحرّك (من غير اللي جوّه وحدة نص) */
  nodes: HTMLElement[]
  /** اتضاف رقم (‎data-move‎) جديد لعنصر — يعني لازم الـHTML يتحفظ تاني عشان الرقم مايضيعش */
  changed: boolean
  /** اللي اتضاف له رقم دلوقتي بالظبط (صندوق الكود بيحتاجهم عشان يكتب الأرقام في النص الأصلي بالمسار) */
  added: HTMLElement[]
}

/**
 * يجهّز جذر قسم مستورد (‎.lb-custom‎) للتحرير:
 *  ١) يعلّم وحدات النص (‎data-lb-text‎) — فيهم أولاً عشان اللي جوّاها يطلع من اللعبة.
 *  ٢) اللي جوّه وحدة نص مابيتحدّدش ولا بيتسحب (‎<span>&</span>‎ جوّه ‎<h1>‎ كان بيخطف التحديد).
 *  ٣) يرقّم اللي مالوش رقم ‎el-N‎ (بادئة القسم المستورد؛ ‎ce-N‎ لمربع الكود في S5).
 *
 * **idempotent**: تشغيله تاني على نفس الـDOM مايعلّمش ‎changed‎ (وإلا: حفظ ⇒ إعادة عرض ⇒ ترقيم ⇒ حفظ… للأبد).
 * ‎changed‎ بيتعلّم بس لما رقم جديد اتضاف — علامة ‎data-lb-text‎ بتتشال عند الحفظ فمابتحسبش.
 */
export function numberElements(root: Element, prefix = root.matches(CODE_ROOTS) ? 'ce-' : 'el-'): Numbered {
  const all = movableIn(root)
  for (const n of all) {
    if (isTextual(n) && !n.parentElement?.closest('[data-lb-text]')) n.setAttribute('data-lb-text', '1')
  }
  const nodes = all.filter((n) => !n.parentElement?.closest('[data-lb-text]'))

  const used = new Set(Array.from(root.querySelectorAll('[data-move]')).map((n) => n.getAttribute('data-move')))
  let next = 1
  let changed = false
  const added: HTMLElement[] = []
  for (const n of nodes) {
    if (n.getAttribute('data-move')) continue
    while (used.has(`${prefix}${next}`)) next++
    const slot = `${prefix}${next}`
    n.setAttribute('data-move', slot)
    used.add(slot)
    changed = true
    added.push(n)
  }
  return { nodes, changed, added }
}
