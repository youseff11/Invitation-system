import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { lookup } from './api'
import { compressImage } from './imageCompress'
import type { Cell, FieldInfo, FieldValue, FileValue, Ref } from './types'

interface Props {
  /** ‎id‎ الخانة الأساسية (التسمية بتشاور عليه) */
  id: string
  /** النص الأصلي بيظهر شفاف في الخانة الفاضية */
  placeholder?: string
  modelKey: string
  info: FieldInfo
  value: FieldValue | undefined
  error?: string
  /** ملف اتختار لحقل ملف/صورة (‎null‎ = اتلغى) */
  file?: File | null
  onChange: (value: FieldValue) => void
  onFile: (file: File | null) => void
}

/** عرض خلية للقراءة فقط (الحقول المقفولة وأعمدة الجداول المرتبطة). */
export function CellView({ cell }: { cell: Cell | undefined }) {
  const { t } = useTranslation()
  if (!cell) return <span className="muted">—</span>
  if (cell.k === 'bool') return <span className={cell.v ? 'da-bool is-on' : 'da-bool'}>{cell.v ? t('dataadmin.yes') : t('dataadmin.no')}</span>
  if (cell.k === 'link' && cell.url)
    return (
      <a href={cell.url} target="_blank" rel="noreferrer">
        {String(cell.v)}
      </a>
    )
  const text = String(cell.v ?? '')
  return text ? <>{cell.k === 'date' ? text.replace('T', ' ') : text}</> : <span className="muted">—</span>
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** بحث + اختيار من الجدول المرتبط (للمفتاح الأجنبي والمتعدد). */
function Picker({
  modelKey,
  field,
  exclude,
  placeholder,
  onPick,
  id,
}: {
  modelKey: string
  field: string
  exclude: (number | string)[]
  placeholder: string
  onPick: (ref: Ref) => void
  id: string
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<{ query: string; items: Ref[] } | null>(null)
  const query = useDebounced(text, 250)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    lookup(modelKey, field, query, controller.signal)
      .then((data) => setLoaded({ query, items: data.results }))
      .catch(() => {})
    return () => controller.abort()
  }, [open, query, modelKey, field])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const loading = loaded?.query !== query
  const visible = (loaded?.items ?? []).filter((r) => !exclude.map(String).includes(String(r.id)))
  return (
    <div className="da-picker" ref={box}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && (
        <ul className="da-picker-list" role="listbox">
          {loading && visible.length === 0 && <li className="muted">{t('dataadmin.loading')}</li>}
          {!loading && visible.length === 0 && <li className="muted">{t('dataadmin.noResults')}</li>}
          {visible.map((ref) => (
            <li key={ref.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(ref)
                  setText('')
                  setOpen(false)
                }}
              >
                {ref.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ForeignKey({ props, id }: { props: Props; id: string }) {
  const { t } = useTranslation()
  const { info, value, modelKey, onChange } = props
  const current = value && !Array.isArray(value) && typeof value === 'object' && 'label' in value ? (value as Ref) : null
  return (
    <div className="da-fk">
      {current && (
        <span className="da-chip">
          {current.label}
          {!info.required && (
            <button type="button" aria-label={t('dataadmin.clear')} onClick={() => onChange(null)}>
              ×
            </button>
          )}
        </span>
      )}
      <Picker
        id={id}
        modelKey={modelKey}
        field={info.name}
        exclude={current ? [current.id] : []}
        placeholder={current ? t('dataadmin.change') : t('dataadmin.pick')}
        onPick={(ref) => onChange(ref)}
      />
    </div>
  )
}

function ManyToMany({ props, id }: { props: Props; id: string }) {
  const { t } = useTranslation()
  const { info, value, modelKey, onChange } = props
  const items = Array.isArray(value) ? (value as Ref[]) : []
  return (
    <div className="da-fk">
      <div className="da-chips">
        {items.map((item) => (
          <span key={item.id} className="da-chip">
            {item.label}
            <button type="button" aria-label={t('dataadmin.remove')} onClick={() => onChange(items.filter((i) => i.id !== item.id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <Picker
        id={id}
        modelKey={modelKey}
        field={info.name}
        exclude={items.map((i) => i.id)}
        placeholder={t('dataadmin.add')}
        onPick={(ref) => onChange([...items, ref])}
      />
    </div>
  )
}

function JsonField({ props, id }: { props: Props; id: string }) {
  const { t } = useTranslation()
  const text = typeof props.value === 'string' ? props.value : ''
  const [open, setOpen] = useState(text.length < 1500)
  let valid = true
  if (text.trim()) {
    try {
      JSON.parse(text)
    } catch {
      valid = false
    }
  }
  const body = (
    <>
      <textarea
        id={id}
        className="da-json"
        dir="ltr"
        rows={text.length > 3000 ? 18 : 8}
        spellCheck={false}
        value={text}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className="da-json-bar">
        <span className={valid ? 'da-ok' : 'da-bad'}>{valid ? t('dataadmin.jsonOk') : t('dataadmin.jsonBad')}</span>
        <span className="muted">{t('dataadmin.chars', { count: text.length })}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!valid || !text.trim()}
          onClick={() => props.onChange(JSON.stringify(JSON.parse(text), null, 2))}
        >
          {t('dataadmin.format')}
        </button>
      </div>
    </>
  )
  if (text.length < 1500) return body
  // مستندات الدعوات/القوالب كبيرة: مطوية لحد ما المستخدم يفتحها
  return (
    <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>{t('dataadmin.bigJson', { count: text.length })}</summary>
      {open && body}
    </details>
  )
}

function FileInput({ props, id }: { props: Props; id: string }) {
  const { t } = useTranslation()
  const { info, value, file, onFile, onChange } = props
  const existing = value && typeof value === 'object' && 'url' in value ? (value as FileValue) : null
  return (
    <div className="da-file">
      {existing && !file && (
        <div className="da-file-current">
          {info.kind === 'image' && existing.url && <img src={existing.url} alt="" />}
          <a href={existing.url} target="_blank" rel="noreferrer">
            {existing.name}
          </a>
          {!info.required && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
              {t('dataadmin.removeFile')}
            </button>
          )}
        </div>
      )}
      {value === null && !file && <span className="muted">{t('dataadmin.fileCleared')}</span>}
      <input
        id={id}
        type="file"
        accept={info.kind === 'image' ? 'image/*' : undefined}
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null
          if (!picked || info.kind !== 'image') return onFile(picked)
          // الصورة بتتضغط في المتصفح قبل الرفع (الأصل لو الضغط مش مفيد أو فشل)
          void compressImage(picked).then(onFile)
        }}
      />
      {file && (
        <small className="muted">
          {file.name} — {(file.size / 1024).toFixed(0)} KB
        </small>
      )}
    </div>
  )
}

export function FieldInput(props: Props) {
  const { t } = useTranslation()
  const { info, value, onChange, id } = props
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value)

  switch (info.kind) {
    case 'bool':
      return (
        <label className="da-check" htmlFor={id}>
          <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>{value === true ? t('dataadmin.yes') : t('dataadmin.no')}</span>
        </label>
      )
    case 'textarea':
      return <textarea id={id} rows={5} value={text} placeholder={props.placeholder} onChange={(event) => onChange(event.target.value)} />
    case 'int':
      return <input id={id} type="number" step={1} value={text} onChange={(event) => onChange(event.target.value)} />
    case 'decimal':
      return (
        <input
          id={id}
          type="number"
          step={info.decimalPlaces ? 1 / 10 ** info.decimalPlaces : 'any'}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'date':
      return <input id={id} type="date" value={text} onChange={(event) => onChange(event.target.value)} />
    case 'datetime':
      return <input id={id} type="datetime-local" step={1} value={text} onChange={(event) => onChange(event.target.value)} />
    case 'choice':
      return (
        <select id={id} value={text} onChange={(event) => onChange(event.target.value)}>
          {(info.blank || !text) && <option value="">{t('dataadmin.none')}</option>}
          {info.choices?.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      )
    case 'multichoice': {
      const picked = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="da-checks" id={id}>
          {info.choices?.map((choice) => (
            <label key={choice.value} className="da-check">
              <input
                type="checkbox"
                checked={picked.includes(choice.value)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...picked, choice.value] : picked.filter((v) => v !== choice.value))
                }
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'fk':
      return <ForeignKey props={props} id={id} />
    case 'm2m':
      return <ManyToMany props={props} id={id} />
    case 'json':
      return <JsonField props={props} id={id} />
    case 'image':
    case 'file':
      return <FileInput props={props} id={id} />
    case 'password':
      return <input id={id} type="password" autoComplete="new-password" value={text} onChange={(event) => onChange(event.target.value)} />
    case 'email':
    case 'url':
      return <input id={id} type="text" dir="ltr" maxLength={info.maxLength} value={text} onChange={(event) => onChange(event.target.value)} />
    default:
      return (
        <input
          id={id}
          type="text"
          maxLength={info.maxLength}
          value={text}
          placeholder={props.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
