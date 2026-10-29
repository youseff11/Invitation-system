import { useTranslation } from 'react-i18next'

import { FontUpload } from '../assets/FontUpload'
import { useSchema } from '../hooks'
import { useEditor } from '../store'
import type { FieldOption } from '../types'
import type { FieldProps } from './registry'

const str = (value: unknown) => (value == null ? '' : String(value))

/** سطر نص واحد / رابط / تاريخ / وقت. */
export function TextBody({ spec, value, onChange, id }: FieldProps) {
  const type = spec.type === 'datetime' ? 'datetime-local' : spec.type === 'date' ? 'date' : spec.type === 'url' ? 'url' : 'text'
  return (
    <input
      id={id}
      className="ed-input"
      type={type}
      value={str(value)}
      placeholder={spec.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** نص متعدد الأسطر (والـhtml نص خام لحد ما محرر النص المنسّق ييجي في C2). */
export function TextAreaBody({ spec, value, onChange, id }: FieldProps) {
  return (
    <textarea
      id={id}
      rows={spec.type === 'html' ? 5 : 3}
      value={str(value)}
      placeholder={spec.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function NumberBody({ spec, value, onChange, id }: FieldProps) {
  return (
    <input
      id={id}
      className="ed-input"
      type="number"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={str(value)}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  )
}

/** شريط + خانة رقم مرتبطين (القيمة نفسها بتظهر في عنوان الحقل). */
export function RangeBody({ spec, value, onChange, id }: FieldProps) {
  const set = (raw: string) => onChange(raw === '' ? '' : Number(raw))
  return (
    <div className="ed-row">
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={str(value) || 0}
        onChange={(e) => set(e.target.value)}
      />
      <input
        className="ed-input"
        type="number"
        style={{ width: 72 }}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={str(value)}
        aria-label={spec.label}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  )
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

export function ColorBody({ spec, value, onChange, id }: FieldProps) {
  const { t } = useTranslation()
  const text = str(value)
  return (
    <div className="ed-color-row">
      <input
        type="color"
        aria-label={spec.label}
        value={HEX6.test(text) ? text : '#b8914f'}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        id={id}
        className="ed-input"
        type="text"
        dir="ltr"
        value={text}
        placeholder={t('editor.fields.theme')}
        onChange={(e) => onChange(e.target.value)}
      />
      {(spec.key === 'bg_color' || spec.clearable) && (
        <button type="button" className="ed-btn ed-btn--sm ed-color-clear" onClick={() => onChange('')}>
          {t('editor.fields.clear')}
        </button>
      )}
    </div>
  )
}

export function SelectBody({ spec, value, onChange, id }: FieldProps) {
  const options = spec.options ?? []
  return (
    <select id={id} value={str(value)} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** الخط: خطوط المحرك + خطوط المكتبة المرفوعة (من غير تكرار) + «افتراضي القالب». */
export function FontBody({ spec, value, onChange, id }: FieldProps) {
  const { t } = useTranslation()
  const { data: schema } = useSchema()
  const library = useEditor((s) => s.lib.fonts)
  const base: FieldOption[] = spec.options ?? schema?.fonts ?? []
  const seen = new Set(base.map((o) => o.value))
  const extra = library
    .filter((f) => f.value && !seen.has(f.value))
    .map((f) => ({ value: f.value, label: t('editor.fields.fromLibrary', { name: f.label || f.name || f.family }) }))
  const options = [{ value: '', label: `— ${t('editor.fields.theme')} —` }, ...base, ...extra]
  return (
    <>
      <select id={id} value={str(value)} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ fontFamily: o.value || undefined }}>
            {o.label}
          </option>
        ))}
      </select>
      <FontUpload onUploaded={(font) => onChange(font.value)} />
    </>
  )
}

const ICONS = ['calendar', 'clock', 'pin', 'heart', 'ring', 'gift', 'phone', 'star', 'music', 'camera', 'cake', 'car', 'dress', 'info']

export function IconBody({ value, onChange, id }: FieldProps) {
  const { t } = useTranslation()
  return (
    <select id={id} value={str(value)} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('editor.fields.none')}</option>
      {ICONS.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

export function AlignBody({ value, onChange }: FieldProps) {
  const { t } = useTranslation()
  const choices: [string, string][] = [
    ['right', t('editor.fields.alignRight')],
    ['center', t('editor.fields.alignCenter')],
    ['left', t('editor.fields.alignLeft')],
  ]
  return (
    <div className="ed-align">
      {choices.map(([key, label]) => (
        <button key={key} type="button" className={value === key ? 'is-active' : undefined} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function ToggleBody({ spec, value, onChange, id }: FieldProps) {
  const { t } = useTranslation()
  const gated = useEditor((s) => !!spec.feature && !s.features.includes(spec.feature))
  return (
    <label className="ed-toggle" htmlFor={id}>
      <span>
        {spec.label}
        {gated && <b className="ed-gate-tag">{t('editor.inspector.outsidePlan')}</b>}
      </span>
      <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="ed-switch" />
    </label>
  )
}

