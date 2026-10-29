import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { FieldSpec } from '../types'
import { FieldRenderer } from './registry'
import { buildStyleIndex, textStyleChildren, type StyleIndex } from './textStyleIndex'

/**
 * نطاق حقول التنسيق: قايمة الحقول اللي الحقل الأب فيها (بما فيها المخفي من المحرر) + قراءة وكتابة قيمها.
 * ‎get/set‎ بيشتغلوا بالحقل نفسه — ترس نص عنصر في قايمة بيكتب في عنصره هو مش في القسم.
 */
export interface StyleScope {
  index: StyleIndex
  get: (spec: FieldSpec) => unknown
  set: (spec: FieldSpec, value: unknown) => void
}

/** يبني النطاق من قايمة الحقول (مرة لكل قايمة، مش مع كل رسمة). */
export function useStyleScope(
  specs: readonly FieldSpec[],
  get: StyleScope['get'],
  set: StyleScope['set'],
): StyleScope {
  const index = useMemo(() => buildStyleIndex(specs), [specs])
  return { index, get, set }
}

/** ترس الحقل لو ليه تنسيق، وإلا ‎undefined‎ — بيتمرّر لـ‎FieldRenderer‎ كـ‎gear‎. */
export function gearFor(spec: FieldSpec, scope: StyleScope): ReactNode {
  const children = textStyleChildren(scope.index, spec)
  return children.length ? <TextStyleGear parent={spec} fields={children} scope={scope} /> : undefined
}

/**
 * زرار الترس + لوحة التنسيق (خط، لون، حجم، وزن، محاذاة، تباعد حروف، ارتفاع سطر…).
 * اللوحة بتتبني عند الفتح بس: قايمة الخطوط كبيرة وفيها ‎<option>‎ بخط لكل واحد.
 */
export function TextStyleGear({ parent, fields, scope }: { parent: FieldSpec; fields: FieldSpec[]; scope: StyleScope }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="ed-font-gear"
        aria-expanded={open}
        aria-label={t('editorSettings.gear.label', { name: parent.label })}
        title={t('editorSettings.gear.title')}
        onClick={() => setOpen((value) => !value)}
      >
        ⚙
      </button>
      {open && (
        <div className="ed-inline-font-panel">
          {fields.map((child) => (
            <FieldRenderer key={child.key} spec={child} value={scope.get(child)} onChange={(value) => scope.set(child, value)} />
          ))}
        </div>
      )}
    </>
  )
}
