import type { FieldSpec } from '../types'

/**
 * ترس النص — تنسيق كل نص جوّه ترسه هو.
 *
 * مفيش خريطة مكتوبة بالإيد: السكيما (‎blocks.py‎) بتعلّم كل حقل تنسيق بـ‎style_of‎ (بتاع أنهي نص)
 * و‎style_role‎ (الترتيب جوّه اللوحة)، وهنا بنلمّهم من نفس قايمة الحقول اللي الحقل الأب فيها —
 * يعني حقل جديد في بايثون بيظهر في الترس من غير أي سطر هنا.
 */
export const TEXT_STYLE_ORDER: Record<string, number> = {
  font: 1,
  color: 2,
  size: 3,
  weight: 4,
  align: 5,
  ls: 6,
  lh: 7,
  zz_extra: 9,
}
const OTHER_ROLE = 8

/** أنواع الحقول اللي ليها ترس (نصوص قصيرة وطويلة، زي القديم) */
export const GEAR_TYPES: ReadonlySet<string> = new Set(['text', 'url', 'date', 'datetime', 'textarea', 'html'])

/** حقول التنسيق مجمّعة بمفتاح النص اللي بتنسّقه، كل مجموعة بترتيب ‎style_role‎. */
export type StyleIndex = ReadonlyMap<string, FieldSpec[]>

export function buildStyleIndex(specs: readonly FieldSpec[]): StyleIndex {
  const index = new Map<string, FieldSpec[]>()
  for (const spec of specs) {
    if (!spec.style_of) continue
    const group = index.get(spec.style_of)
    if (group) group.push(spec)
    else index.set(spec.style_of, [spec])
  }
  for (const group of index.values()) {
    // ترتيب ثابت: نفس الدور بيفضل بترتيبه في السكيما
    group.sort((a, b) => (TEXT_STYLE_ORDER[a.style_role ?? ''] ?? OTHER_ROLE) - (TEXT_STYLE_ORDER[b.style_role ?? ''] ?? OTHER_ROLE))
  }
  return index
}

/** حقول تنسيق النص ده (فاضية = مفيش ترس). */
export function textStyleChildren(index: StyleIndex, spec: FieldSpec): FieldSpec[] {
  return GEAR_TYPES.has(spec.type) ? (index.get(spec.key) ?? []) : []
}
