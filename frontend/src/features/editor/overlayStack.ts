import type { Props } from './types'

/** علامة «محتوى القسم» وسط ترتيب العناصر: اللي قبلها تحت المحتوى واللي بعدها فوقه. */
export const CONTENT = 'content' as const
export type Slot = number | typeof CONTENT

export type Move = 'up' | 'down' | 'front' | 'back'

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/**
 * ترتيب الطبقات من التحت لفوق: العناصر اللي ‎behind‎ (بالـ‎z‎)، ثم محتوى القسم، ثم الباقي (بالـ‎z‎).
 * التعادل بيتفك بترتيب الإضافة — يعني الدعوة القديمة (من غير ‎z‎) بتفضل زي ما كانت.
 */
export function stackOrder(items: Props[]): Slot[] {
  const rank = (i: number) => [items[i].behind === true ? 0 : 1, num(items[i].z), i] as const
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const [ga, za, ia] = rank(a)
      const [gb, zb, ib] = rank(b)
      return ga - gb || za - zb || ia - ib
    })
  const split = order.findIndex((i) => items[i].behind !== true)
  const at = split === -1 ? order.length : split
  return [...order.slice(0, at), CONTENT, ...order.slice(at)]
}

/**
 * ينقل عنصر خطوة (أو لأول/آخر الترتيب) ويرجّع القايمة الجديدة، أو ‎null‎ لو مفيش حاجة تتغيّر.
 * بيكتب ‎z‎ و‎behind‎ لكل العناصر اللي اتغيّر ترتيبها في خطوة واحدة؛ مفاتيح الباقي مابتتلمسش.
 */
export function moveLayer(items: Props[], index: number, move: Move): Props[] | null {
  const order = stackOrder(items)
  const from = order.indexOf(index)
  if (from === -1) return null
  const to = move === 'up' ? from + 1 : move === 'down' ? from - 1 : move === 'front' ? order.length - 1 : 0
  if (to < 0 || to >= order.length || to === from) return null
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, index)

  const split = next.indexOf(CONTENT)
  const result = items.map((item) => item)
  let changed = false
  next.forEach((slot, position) => {
    if (slot === CONTENT) return
    const behind = position < split
    // ‎z‎ هو الترتيب جوّه نفس الجهة (من صفر) — الحد الأقصى ٦٠ زي السكيما
    const z = Math.min(60, behind ? position : position - split - 1)
    const item = items[slot]
    if ((item.behind === true) === behind && num(item.z) === z) return
    changed = true
    result[slot] = { ...item, z, behind }
  })
  return changed ? result : null
}
