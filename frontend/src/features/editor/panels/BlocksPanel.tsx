import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FavoritesButton } from '../assets/FavoritesDialog'
import { useEditor } from '../store'
import type { BlockSpec, DocBlock, EditorSchema } from '../types'
import { useEditorUi } from '../ui'
import { BlockPicker } from './BlockPicker'

interface RowProps {
  block: DocBlock
  spec: BlockSpec | undefined
  selected: boolean
  gated: boolean
  onDelete: (block: DocBlock, name: string) => void
}

function Row({ block, spec, selected, gated, onDelete }: RowProps) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const select = useEditor((s) => s.select)
  const toggleVisible = useEditor((s) => s.toggleVisible)
  const duplicate = useEditor((s) => s.duplicate)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })

  const name = block.label || spec?.label || block.type
  const classes = ['ed-block', selected && 'is-selected', !block.visible && 'is-hidden', isDragging && 'is-dragging']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={setNodeRef}
      className={classes}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-id={block.id}
      onClick={() => select(block.id, 'list')}
    >
      <span
        className="ed-block-grip"
        title={t('editor.blocks.drag')}
        style={{ touchAction: 'none' }}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        ⠿
      </span>
      <span className="ed-block-icon">{spec?.icon ?? '□'}</span>
      <span className="ed-block-name" title={block.label && spec ? `${block.label} — ${spec.label}` : undefined}>
        {name}
      </span>
      {gated && <span className="ed-block-tag">{t('editor.blocks.warn')}</span>}
      <div className="ed-block-actions">
        <button
          type="button"
          className={`ed-icon-btn${block.visible ? ' is-on' : ''}`}
          title={block.visible ? t('editor.blocks.hide') : t('editor.blocks.show')}
          onClick={(e) => {
            e.stopPropagation()
            toggleVisible(block.id)
          }}
        >
          {block.visible ? '◉' : '○'}
        </button>
        <button
          type="button"
          className="ed-icon-btn"
          title={t('editor.blocks.duplicate')}
          onClick={(e) => {
            e.stopPropagation()
            if (spec?.singleton) ui.toast(t('editor.toast.noDuplicate'), 'error')
            else duplicate(block.id)
          }}
        >
          ⧉
        </button>
        <button
          type="button"
          className="ed-icon-btn"
          title={t('editor.blocks.delete')}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(block, name)
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** تبويب الأقسام: قايمة بالسحب (ماوس/لمس/كيبورد)، إخفاء، تكرار، حذف، وإضافة قسم. */
export function BlocksPanel({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const blocks = useEditor((s) => s.doc.blocks)
  const selected = useEditor((s) => s.selected)
  const features = useEditor((s) => s.features)
  const move = useEditor((s) => s.move)
  const remove = useEditor((s) => s.remove)
  const [picking, setPicking] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) move(String(active.id), String(over.id))
  }

  const onDelete = async (block: DocBlock, name: string) => {
    if (!(await ui.confirm(t('editor.blocks.deleteConfirm', { name }), { danger: true }))) return
    remove(block.id)
    ui.toast(t('editor.toast.removed', { name }), 'ok')
  }

  return (
    <>
      <div className="ed-section-head">
        <p className="ed-kicker">{t('editor.blocks.heading')}</p>
        <div className="ed-section-actions">
          <button type="button" className="ed-btn ed-btn--sm" onClick={() => setPicking(true)}>
            {t('editor.blocks.add')}
          </button>
          <FavoritesButton schema={schema} />
        </div>
      </div>
      <p className="ed-hint">{t('editor.blocks.hint')}</p>

      {blocks.length === 0 ? (
        <p className="ed-empty">{t('editor.blocks.empty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="ed-blocks">
              {blocks.map((block) => {
                const spec = schema.blocks[block.type]
                return (
                  <Row
                    key={block.id}
                    block={block}
                    spec={spec}
                    selected={block.id === selected}
                    gated={!!spec?.feature && !features.includes(spec.feature)}
                    onDelete={onDelete}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {picking && <BlockPicker schema={schema} onClose={() => setPicking(false)} />}
    </>
  )
}

