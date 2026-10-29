import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * يقفل كل مجموعات اللوحة المفتوحة (‎<details class="ed-group">‎) مرة واحدة. بيشتغل على الـDOM عشان يشمل
 * المجموعات اللي حالتها في الأب (‎FieldGroups‎) واللي مفتوحة بشكل ثابت (العنصر المحدَّد)؛ حدث ‎toggle‎
 * بيحدّث حالة الأولى لوحده.
 */
export function CollapseAllButton() {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className="ed-btn ed-btn--sm ed-btn--block ed-collapse-all"
      onClick={() => ref.current?.closest('.ed-tabpane')?.querySelectorAll<HTMLDetailsElement>('details.ed-group[open]').forEach((d) => (d.open = false))}
    >
      {t('editor.inspector.collapseAll')}
    </button>
  )
}
