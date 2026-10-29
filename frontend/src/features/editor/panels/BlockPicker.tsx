import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { BlockSpec, EditorSchema } from '../types'
import { useEditorUi } from '../ui'

/** نافذة «إضافة قسم»: الأنواع مجمّعة بالتصنيف، المفرد (singleton) الموجود بيتعطّل. */
export function BlockPicker({ schema, onClose }: { schema: EditorSchema; onClose: () => void }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const blocks = useEditor((s) => s.doc.blocks)
  const features = useEditor((s) => s.features)
  const addBlock = useEditor((s) => s.addBlock)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const categories = new Map<string, BlockSpec[]>()
  for (const spec of Object.values(schema.blocks)) {
    const name = spec.category || t('editor.inspector.defaultGroup')
    categories.set(name, [...(categories.get(name) ?? []), spec])
  }

  const pick = (spec: BlockSpec) => {
    if (addBlock(spec)) ui.toast(t('editor.toast.added', { name: spec.label }), 'ok')
    onClose()
  }

  return (
    <div className="ed-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-modal-card" role="dialog" aria-modal="true" aria-label={t('editor.blocks.pickerTitle')}>
        <h3>{t('editor.blocks.pickerTitle')}</h3>
        <p>{t('editor.blocks.pickerHint')}</p>
        {[...categories].map(([name, specs]) => (
          <div key={name}>
            <p className="ed-kicker">{name}</p>
            <div className="ed-picker">
              {specs.map((spec) => {
                const exists = spec.singleton && blocks.some((b) => b.type === spec.type)
                const outside = !!spec.feature && !features.includes(spec.feature)
                return (
                  <button key={spec.type} type="button" className="ed-pick" disabled={exists} onClick={() => pick(spec)}>
                    <i>{spec.icon}</i>
                    <div>
                      <strong>{spec.label}</strong>
                      <small>
                        {exists ? t('editor.blocks.exists') : outside ? t('editor.blocks.outsidePlan') : spec.description}
                      </small>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <div className="ed-modal-actions">
          <button type="button" className="ed-btn" onClick={onClose}>
            {t('editor.blocks.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
