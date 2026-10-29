import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DUPLICATE_OFFSET } from '../store'
import type { AddVariant, FieldSpec, Props } from '../types'
import { FieldRenderer, type FieldProps } from './registry'
import { gearFor } from './textStyle'
import { buildStyleIndex } from './textStyleIndex'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const KIND_ICON: Record<string, string> = { text: '¶', image: '▣', button: '⬬' }
const KIND_KEY: Record<string, string> = { text: 'kindText', image: 'kindImage', button: 'kindButton' }

/** حقل فرعي بيظهر لأنواع عناصر معيّنة بس (نص/صورة/زرار). */
export function fieldFitsItem(sub: FieldSpec, item: Props): boolean {
  if (!sub.show_kind?.length) return true
  return sub.show_kind.includes(String(item.kind || 'text'))
}

/** عنوان كارت العنصر: أول حقل نصي فيه كلام، وإلا نوعه، وإلا ترتيبه. */
export function listItemTitle(spec: FieldSpec, item: Props, index: number, t: TFunction): string {
  for (const sub of spec.fields ?? []) {
    if (!fieldFitsItem(sub, item) || (sub.type !== 'text' && sub.type !== 'textarea')) continue
    const value = item[sub.key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 40)
  }
  const kind = String(item.kind || '')
  if (KIND_ICON[kind]) return `${KIND_ICON[kind]} ${t(`editor.fields.${KIND_KEY[kind]}`)} ${index + 1}`
  return String(item.label || item.name || t('editor.fields.item', { n: index + 1 })).slice(0, 40)
}

/** صف جديد من قيم الحقول الافتراضية (+ نوع العنصر لو القايمة متعددة الأنواع). */
export function newListItem(spec: FieldSpec, variant?: AddVariant): Props {
  const row: Props = {}
  for (const sub of spec.fields ?? []) row[sub.key] = clone(sub.default)
  if (variant) Object.assign(row, { [variant.key]: variant.value }, variant.seed ?? {})
  return row
}

/** قايمة متكررة: كارت لكل عنصر (ترتيب، تكرار، حذف) وحقوله الفرعية من السكيما. */
export function ListBody({ spec, value, onChange }: FieldProps) {
  const { t } = useTranslation()
  const items: Props[] = Array.isArray(value) ? (value as Props[]) : []

  const replace = (next: Props[]) => onChange(next)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = items.slice()
    next.splice(to, 0, next.splice(from, 1)[0])
    replace(next)
  }
  const patch = (index: number, key: string, fieldValue: unknown) =>
    replace(items.map((item, i) => (i === index ? { ...item, [key]: fieldValue } : item)))
  const add = (variant?: AddVariant) => replace([...items, newListItem(spec, variant)])

  // عنصر القايمة بيتخزن لوحده، فترس نصه بيتبني من حقول العنصر نفسه (نص الأوفرلاي مثلاً)
  const styleIndex = useMemo(() => buildStyleIndex(spec.fields ?? []), [spec.fields])

  const variants = spec.add_variants ?? []
  const addBar = variants.length ? (
    <div className="ed-add-row">
      {variants.map((variant) => (
        <button key={variant.value} type="button" className="ed-btn ed-btn--sm ed-add-btn" onClick={() => add(variant)}>
          {variant.label}
        </button>
      ))}
    </div>
  ) : (
    <button type="button" className="ed-btn ed-btn--sm ed-btn--block" onClick={() => add()}>
      ＋ {spec.add_label || t('editor.fields.listAdd')}
    </button>
  )

  const list = (
    <div className="ed-list">
      {!items.length && <p className="ed-hint">{t('editor.fields.listEmpty')}</p>}
      {items.map((item, index) => (
        <div className="ed-list-item" key={index}>
          <div className="ed-list-head">
            <span>{listItemTitle(spec, item, index, t)}</span>
            <button type="button" className="ed-icon-btn" title={t('editor.fields.up')} onClick={() => move(index, index - 1)}>
              ▲
            </button>
            <button type="button" className="ed-icon-btn" title={t('editor.fields.down')} onClick={() => move(index, index + 1)}>
              ▼
            </button>
            <button
              type="button"
              className="ed-icon-btn"
              title={t('editor.fields.duplicate')}
              onClick={() => {
                const next = items.slice()
                const copy = clone(item)
                // عنصر فوق القسم: النسخة تنزل شوية عن الأصل وإلا هتقعد فوقه بالظبط
                if (spec.key === 'text_overlays') copy.y = (Number(copy.y) || 0) + DUPLICATE_OFFSET
                next.splice(index + 1, 0, copy)
                replace(next)
              }}
            >
              ⧉
            </button>
            <button
              type="button"
              className="ed-icon-btn"
              title={t('editor.fields.delete')}
              onClick={() => replace(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <div className="ed-list-body">
            {(spec.fields ?? [])
              .filter((sub) => !sub.editor_hidden && fieldFitsItem(sub, item))
              .map((sub) => (
                <FieldRenderer
                  key={sub.key}
                  spec={sub}
                  value={item[sub.key]}
                  onChange={(v) => patch(index, sub.key, v)}
                  gear={gearFor(sub, { index: styleIndex, get: (child) => item[child.key], set: (child, v) => patch(index, child.key, v) })}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  )

  // قايمة متعددة الأنواع: أزرار الإضافة فوق عشان تبان من أول نظرة
  return variants.length ? (
    <>
      {addBar}
      {list}
    </>
  ) : (
    <>
      {list}
      {addBar}
    </>
  )
}
