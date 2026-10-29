import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { BlockSpec, DocBlock } from '../types'
import { useEditorUi } from '../ui'

const STEP = 0.5
const fmt = (n: number) => `${n.toFixed(1)}٪`

/** «مواضع النصوص»: العناصر اللي اتسحبت في المعاينة بإزاحتها، مع خطوات صغيرة وتصفير وإرجاع الكل. */
export function LayoutGroup({ block, spec }: { block: DocBlock; spec: BlockSpec }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const nudge = useEditor((s) => s.nudgeLayout)
  const setLayout = useEditor((s) => s.setLayout)
  const reset = useEditor((s) => s.resetLayout)
  const moved = Object.entries(block.layout ?? {})
  const labelOf = (slot: string) =>
    spec.props.find((f) => f.key === slot)?.label ?? t(`editorInline.layout.slots.${slot}`, { defaultValue: slot })

  const steps: [string, number, number][] = [
    ['right', STEP, 0],
    ['left', -STEP, 0],
    ['down', 0, STEP],
    ['up', 0, -STEP],
  ]

  return (
    <details className="ed-group">
      <summary>
        <span>{t('editorInline.layout.heading')}</span>
      </summary>
      <div className="ed-group-body">
        {!moved.length && <p className="ed-hint">{t('editorInline.layout.hint')}</p>}
        {moved.map(([slot, pos]) => (
          <div className="ed-field" key={slot} data-layout-slot={slot}>
            <label>
              <span>{labelOf(slot)}</span>
              <b>
                {fmt(pos.dx)} / {fmt(pos.dy)}
              </b>
            </label>
            <div className="ed-row">
              {steps.map(([name, ddx, ddy]) => (
                <button
                  key={name}
                  type="button"
                  className="ed-btn ed-btn--sm"
                  title={t('editorInline.layout.step')}
                  onClick={() => nudge(block.id, slot, ddx, ddy)}
                >
                  {t(`editorInline.layout.${name}`)}
                </button>
              ))}
              <button type="button" className="ed-btn ed-btn--sm" onClick={() => setLayout(block.id, slot, 0, 0)}>
                {t('editorInline.layout.zero')}
              </button>
            </div>
          </div>
        ))}
        {moved.length > 0 && (
          <button
            type="button"
            className="ed-btn ed-btn--sm ed-btn--block"
            onClick={() => {
              reset(block.id)
              ui.toast(t('editorInline.layout.resetDone'), 'info')
            }}
          >
            {t('editorInline.layout.resetAll')}
          </button>
        )}
      </div>
    </details>
  )
}
