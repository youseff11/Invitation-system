import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldRenderer } from '../fields'
import { fieldFitsItem, listItemTitle } from '../fields/ListField'
import { gearFor } from '../fields/textStyle'
import { buildStyleIndex } from '../fields/textStyleIndex'
import { useEditor } from '../store'
import type { DocBlock, FieldSpec, Props } from '../types'

/**
 * خصائص «العنصر فوق القسم» المحدَّد في المعاينة (نص/صورة/زرار): نفس حقول عنصر القايمة في السكيما
 * (النص وترس تنسيقه، الصورة، نص الزرار ورابطه، العرض والموضع) — بتفتح لوحدها أول ما العنصر يتحدّد.
 */
export function OverlayPanel({ block, spec }: { block: DocBlock; spec: FieldSpec }) {
  const { t } = useTranslation()
  const sel = useEditor((s) => (s.selOverlay?.blockId === block.id ? s.selOverlay : null))
  const setProp = useEditor((s) => s.setProp)
  const removeOverlay = useEditor((s) => s.removeOverlay)
  const duplicateOverlay = useEditor((s) => s.duplicateOverlay)
  const selectOverlay = useEditor((s) => s.selectOverlay)
  const styleIndex = useMemo(() => buildStyleIndex(spec.fields ?? []), [spec.fields])

  const items: Props[] = Array.isArray(block.props.text_overlays) ? (block.props.text_overlays as Props[]) : []
  const item = sel ? items[sel.index] : undefined
  if (!sel || !item) return null

  const patch = (key: string, value: unknown) =>
    setProp(block.id, 'text_overlays', items.map((it, i) => (i === sel.index ? { ...it, [key]: value } : it)))

  return (
    <details className="ed-group ed-group--accent ed-overlay-panel" open>
      <summary>
        <span>
          {t('editorInline.overlays.selected')} · {listItemTitle(spec, item, sel.index, t)}
        </span>
      </summary>
      <div className="ed-group-body">
        {(spec.fields ?? [])
          .filter((sub) => !sub.editor_hidden && fieldFitsItem(sub, item))
          .map((sub) => (
            <FieldRenderer
              key={`${sel.index}:${sub.key}`}
              spec={sub}
              value={item[sub.key]}
              onChange={(v) => patch(sub.key, v)}
              gear={gearFor(sub, { index: styleIndex, get: (child) => item[child.key], set: (child, v) => patch(child.key, v) })}
            />
          ))}
        <div className="ed-ctrl-line">
          <button type="button" className="ed-btn ed-btn--sm" onClick={() => selectOverlay(block.id, null)}>
            {t('editorInline.overlays.done')}
          </button>
          <button type="button" className="ed-btn ed-btn--sm" title="Ctrl+D" onClick={duplicateOverlay}>
            ⧉ {t('editorInline.overlays.duplicate')}
          </button>
          <button type="button" className="ed-btn ed-btn--sm ed-btn--danger" title="Delete" onClick={removeOverlay}>
            {t('editorInline.overlays.remove')}
          </button>
        </div>
        <p className="ed-hint">{t('editorInline.overlays.hint')}</p>
      </div>
    </details>
  )
}
