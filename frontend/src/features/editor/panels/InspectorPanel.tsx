import { useTranslation } from 'react-i18next'

import { SaveFavoriteButton } from '../assets/FavoritesDialog'
import { findBlock, INTRO_ID } from '../doc'
import { splitCode } from '../imported/source'
import { hasCountdown } from '../imported/units'
import { useEditor } from '../store'
import type { EditorSchema } from '../types'
import { CollapseAllButton } from './CollapseAllButton'
import { FieldGroups, useOpenGroups } from './FieldGroups'
import { ColorGroup } from './ColorGroup'
import { ElementPanel } from './ElementPanel'
import { LayersGroup } from './LayersGroup'
import { LayoutGroup } from './LayoutGroup'
import { OverlayLayers } from './OverlayLayers'
import { OverlayPanel } from './OverlayPanel'

/** خصائص القسم المحدَّد: الاسم، ثم مجموعات حقول المحتوى ثم التنسيق — كلها مبنية من السكيما. */
export function InspectorPanel({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const block = useEditor((s) => findBlock(s.doc, s.selected))
  const selected = useEditor((s) => s.selected)
  const features = useEditor((s) => s.features)
  const setTab = useEditor((s) => s.setTab)
  const rename = useEditor((s) => s.rename)
  const boundsOn = useEditor((s) => s.boundsBlock === s.selected)
  const toggleBounds = useEditor((s) => s.toggleBounds)
  const setProp = useEditor((s) => s.setProp)
  const setStyle = useEditor((s) => s.setStyle)
  const elementPicked = useEditor((s) => s.selEl?.blockId === s.selected)
  const props = useOpenGroups()
  const style = useOpenGroups()

  // كود الافتتاحية: مش قسم في القايمة — بتتحدّد من المعاينة (عناصره ‎ce-N‎ في ‎settings.intro_code‎)
  if (selected === INTRO_ID) {
    return (
      <>
        <CollapseAllButton />
        <div className="ed-section-head">
          <div>
            <p className="ed-kicker">{t('editor.inspector.selected')}</p>
            <strong>{t('editorInline.intro.title')}</strong>
          </div>
          <div className="ed-section-actions">
            <button type="button" className="ed-btn ed-btn--sm" onClick={() => setTab('blocks')}>
              {t('editor.inspector.back')}
            </button>
          </div>
        </div>
        <p className="ed-hint">{t('editorInline.intro.hint')}</p>
        <ElementPanel blockId={INTRO_ID} />
        <LayersGroup blockId={INTRO_ID} kind="code" />
      </>
    )
  }
  if (!block) return <p className="ed-empty">{t('editor.inspector.empty')}</p>
  const spec = schema.blocks[block.type]
  if (!spec) return null
  const gated = !!spec.feature && !features.includes(spec.feature)
  // «كود متقدّم» فيه HTML (مش ستايل وسكربت بس) = صندوق عناصر بتتحدّد وتتحرّك
  const hasCodeBox = typeof block.props.code === 'string' && splitCode(block.props.code).region.trim() !== ''

  // قسم «كود مخصص»: بنعرض بس اللي ليه لازمة — الكود مفتوح وجاهز، العدّاد لو فيه عدّاد، والمواضع بتتسحب بالماوس. الألوان من العنصر المحدَّد.
  const custom = block.type === 'custom_html'
  const groupsOf = (...keys: string[]) => spec.props.filter((f) => keys.includes(f.key)).map((f) => f.group || '')
  // «عناصر فوق القسم» (نص/صورة/زرار) مابتظهرش في لوحة أي قسم: بتتضاف من شريط المعاينة وبتتحدّد وتتسحب وتتحذف من المعاينة
  const hide = [
    ...groupsOf('text_overlays'),
    ...(custom && !hasCountdown(typeof block.props.html === 'string' ? block.props.html : '')
      ? groupsOf('countdown_date', 'countdown_dir')
      : []),
  ]
  const overlaySpec = spec.props.find((f) => f.key === 'text_overlays')
  const element = custom || hasCodeBox
  const elementPanel = element && (
    <ElementPanel blockId={block.id} countdown={spec.props.filter((f) => f.key === 'countdown_date' || f.key === 'countdown_dir')} />
  )

  return (
    <>
      <CollapseAllButton />
      <div className="ed-section-head">
        <div>
          <p className="ed-kicker">{t('editor.inspector.selected')}</p>
          <strong>{block.label || spec.label}</strong>
        </div>
        <div className="ed-section-actions">
          <SaveFavoriteButton block={block} spec={spec} />
          <button type="button" className="ed-btn ed-btn--sm" onClick={() => setTab('blocks')}>
            {t('editor.inspector.back')}
          </button>
        </div>
      </div>

      {overlaySpec && <OverlayPanel block={block} spec={overlaySpec} />}
      {overlaySpec && <OverlayLayers block={block} spec={overlaySpec} />}

      <div className="ed-field">
        <label htmlFor="ed-block-name">
          <span>{t('editor.inspector.rename')}</span>
        </label>
        <input
          id="ed-block-name"
          className="ed-input"
          type="text"
          maxLength={60}
          placeholder={spec.label}
          value={block.label ?? ''}
          onChange={(e) => rename(block.id, e.target.value)}
        />
      </div>

      <div className="ed-section-bounds-tools">
        <button type="button" className="ed-btn ed-btn--sm ed-btn--block" aria-pressed={boundsOn} onClick={() => toggleBounds(block.id)}>
          {t(boundsOn ? 'editorInline.bounds.hide' : 'editorInline.bounds.show')}
        </button>
        <small className="ed-hint">{t('editorInline.bounds.hint')}</small>
      </div>

      {spec.description && <p className="ed-hint">{spec.description}</p>}
      {gated && <p className="ed-hint ed-hint--danger">{t('editor.inspector.gated')}</p>}

      {custom && elementPanel}
      <FieldGroups
        specs={spec.props}
        hide={hide}
        defaultOpen={custom ? groupsOf('code') : []}
        get={(s) => block.props[s.key]}
        set={(s, v) => setProp(block.id, s.key, v)}
        open={props.open}
        onToggle={props.onToggle}
        openFirst={!custom}
      />
      {spec.style.length > 0 && (
        <FieldGroups
          specs={spec.style}
          get={(s) => block.style[s.key]}
          set={(s, v) => setStyle(block.id, s.key, v)}
          open={style.open}
          onToggle={style.onToggle}
          openFirst={false}
        />
      )}
      {!custom && <LayoutGroup block={block} spec={spec} />}
      {custom && !elementPicked && <ColorGroup block={block} />}
      {!custom && elementPanel}
      {custom && <LayersGroup blockId={block.id} />}
      {hasCodeBox && <LayersGroup blockId={block.id} kind="code" />}
    </>
  )
}
