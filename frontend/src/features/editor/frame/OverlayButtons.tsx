import { useTranslation } from 'react-i18next'

import { findBlock } from '../doc'
import { newListItem } from '../fields/ListField'
import { useSchema } from '../hooks'
import { useEditor } from '../store'
import type { Props } from '../types'
import { useEditorUi } from '../ui'

/**
 * «＋ نص / ＋ صورة / ＋ زرار» في شريط المعاينة (جنب «الافتتاحية»): بتضيف عنصر فوق القسم المحدَّد، وبعدها
 * بيتسحب بالماوس في المعاينة. الأزرار نفسها (وكلامها وبذرتها) جاية من حقل ‎text_overlays‎ في السكيما.
 */
export function OverlayButtons() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const { data: schema } = useSchema()
  const setProp = useEditor((s) => s.setProp)
  const type = useEditor((s) => findBlock(s.doc, s.selected)?.type ?? null)

  const spec = schema?.blocks.custom_html?.props.find((f) => f.key === 'text_overlays')
  if (!spec) return null

  const add = (index: number) => {
    const { doc, selected } = useEditor.getState()
    const block = findBlock(doc, selected)
    if (!block) return ui.toast(t('editorInline.overlays.pick'), 'info')
    const own = schema?.blocks[block.type]?.props.find((f) => f.key === 'text_overlays')
    if (!own) return ui.toast(t('editorInline.overlays.unsupported'), 'error')
    const items: Props[] = Array.isArray(block.props.text_overlays) ? (block.props.text_overlays as Props[]) : []
    setProp(block.id, 'text_overlays', [...items, newListItem(own, own.add_variants?.[index])])
  }

  return (
    <span className="ed-overlay-add" role="group" title={t('editorInline.overlays.title')}>
      {(spec.add_variants ?? []).map((variant, index) => (
        <button key={variant.value} type="button" className="ed-btn ed-btn--sm" disabled={!type} onClick={() => add(index)}>
          {variant.label}
        </button>
      ))}
    </span>
  )
}
