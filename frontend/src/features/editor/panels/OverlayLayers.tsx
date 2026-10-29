import { useTranslation } from 'react-i18next'

import { listItemTitle } from '../fields/ListField'
import { CONTENT, moveLayer, stackOrder, type Move } from '../overlayStack'
import { useEditor } from '../store'
import type { DocBlock, FieldSpec, Props } from '../types'

/**
 * «ترتيب الطبقات» للعناصر فوق القسم (نص/صورة/زرار): قايمة من فوق لتحت زي برامج التصميم، ومحتوى القسم نفسه
 * صف في النص — فالعنصر ينزل تحت الكلام (مثلاً صورة خلفية للنص) أو يطلع فوقه بسهم واحد.
 */
export function OverlayLayers({ block, spec }: { block: DocBlock; spec: FieldSpec }) {
  const { t } = useTranslation()
  const selected = useEditor((s) => (s.selOverlay?.blockId === block.id ? s.selOverlay.index : null))
  const selectOverlay = useEditor((s) => s.selectOverlay)
  const setProp = useEditor((s) => s.setProp)

  const items: Props[] = Array.isArray(block.props.text_overlays) ? (block.props.text_overlays as Props[]) : []
  if (items.length === 0) return null

  // من فوق لتحت (عكس ترتيب الرسم)
  const rows = stackOrder(items).slice().reverse()
  const apply = (index: number, move: Move) => {
    const next = moveLayer(items, index, move)
    if (next) setProp(block.id, 'text_overlays', next)
  }
  const can = (move: Move) => selected !== null && moveLayer(items, selected, move) !== null

  return (
    <details className="ed-group ed-layers-group" open>
      <summary>
        <span>{t('editorInline.overlays.layers.title')}</span>
      </summary>
      <div className="ed-group-body">
        <div className="ed-ctrl-line">
          <button type="button" className="ed-btn ed-btn--sm" disabled={!can('front')} onClick={() => apply(selected as number, 'front')}>
            {t('editorInline.overlays.layers.front')}
          </button>
          <button type="button" className="ed-btn ed-btn--sm" disabled={!can('back')} onClick={() => apply(selected as number, 'back')}>
            {t('editorInline.overlays.layers.back')}
          </button>
        </div>
        <ul className="ed-ovl-layers" aria-label={t('editorInline.overlays.layers.title')}>
          {rows.map((slot) =>
            slot === CONTENT ? (
              <li key="content" className="ed-ovl-layer ed-ovl-layer--content">
                {t('editorInline.overlays.layers.content')}
              </li>
            ) : (
              <li key={slot} className={`ed-ovl-layer${selected === slot ? ' is-selected' : ''}`}>
                <button type="button" className="ed-ovl-layer-pick" onClick={() => selectOverlay(block.id, slot)}>
                  {listItemTitle(spec, items[slot], slot, t)}
                </button>
                <button
                  type="button"
                  className="ed-btn ed-btn--sm ed-ovl-layer-move"
                  title={t('editorInline.overlays.layers.up')}
                  aria-label={t('editorInline.overlays.layers.up')}
                  disabled={moveLayer(items, slot, 'up') === null}
                  onClick={() => apply(slot, 'up')}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="ed-btn ed-btn--sm ed-ovl-layer-move"
                  title={t('editorInline.overlays.layers.down')}
                  aria-label={t('editorInline.overlays.layers.down')}
                  disabled={moveLayer(items, slot, 'down') === null}
                  onClick={() => apply(slot, 'down')}
                >
                  ▼
                </button>
              </li>
            ),
          )}
        </ul>
        <p className="ed-hint">{t('editorInline.overlays.layers.hint')}</p>
      </div>
    </details>
  )
}
