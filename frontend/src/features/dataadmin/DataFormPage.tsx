import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { PageHead, usePageTitle } from '@/features/dashboard/ui/page'
import { QueryState, Table } from '@/features/dashboard/ui/table'
import { errorText, useToast } from '@/features/dashboard/ui/Toast'

import { dataKeys, saveObject, setUserPassword, useDataObject, useDataSchema } from './api'
import { DeleteDialog } from './DeleteDialog'
import { CellView, FieldInput } from './Fields'
import { heroDefaultKey, heroFieldVisible, HeroPreview, viewForField, type HeroView } from './HeroPreview'
import type { FieldInfo, FieldValue, ObjectResponse, SchemaResponse, Values } from './types'
import './dataadmin.css'

const FILE_KINDS = new Set(['image', 'file'])

function Row({
  modelKey,
  info,
  value,
  error,
  file,
  readonly,
  onChange,
  onFile,
  placeholder,
}: {
  modelKey: string
  info: FieldInfo
  value: FieldValue | undefined
  error?: string
  file?: File | null
  readonly?: ObjectResponse['readonly'][string]
  onChange: (value: FieldValue) => void
  onFile: (file: File | null) => void
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className={`da-row${error ? ' has-error' : ''}`} data-field={info.name}>
      <label htmlFor={id}>
        {info.label}
        {info.required && info.kind !== 'readonly' && <b aria-hidden="true"> *</b>}
      </label>
      <div className="da-control">
        {info.kind === 'readonly' ? (
          <div className="da-readonly" id={id}>
            <CellView cell={readonly} />
          </div>
        ) : (
          <FieldInput id={id} modelKey={modelKey} info={info} value={value} file={file} placeholder={placeholder} onChange={onChange} onFile={onFile} />
        )}
        {info.help && <small className="muted">{info.help}</small>}
        {error && (
          <ul className="errorlist" role="alert">
            <li>{error}</li>
          </ul>
        )}
      </div>
    </div>
  )
}

function PasswordPanel({ id }: { id: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [one, setOne] = useState('')
  const [two, setTwo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await setUserPassword(id, one, two)
      toast.success(t('dataadmin.passwordChanged'))
      setOne('')
      setTwo('')
    } catch (failure) {
      const fields = failure instanceof ApiError ? failure.fields : undefined
      setError(fields ? Object.values(fields).join(' — ') : errorText(failure, t('dataadmin.saveFailed'), t('dataadmin.network')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="da-section card" onSubmit={(event) => void submit(event)}>
      <h2>{t('dataadmin.changePassword')}</h2>
      <div className="da-row">
        <label htmlFor="da-pw1">{t('dataadmin.newPassword')}</label>
        <div className="da-control">
          <input id="da-pw1" type="password" autoComplete="new-password" value={one} onChange={(event) => setOne(event.target.value)} />
        </div>
      </div>
      <div className="da-row">
        <label htmlFor="da-pw2">{t('dataadmin.confirmPassword')}</label>
        <div className="da-control">
          <input id="da-pw2" type="password" autoComplete="new-password" value={two} onChange={(event) => setTwo(event.target.value)} />
          {error && (
            <ul className="errorlist" role="alert">
              <li>{error}</li>
            </ul>
          )}
        </div>
      </div>
      <div className="da-actions">
        <button className="btn btn--ghost btn--sm" type="submit" disabled={busy || !one}>
          {t('dataadmin.changePassword')}
        </button>
      </div>
    </form>
  )
}

/** نموذج إضافة/تعديل سجل — الحقول والأقسام من ‎ModelAdmin‎ (‎/data/<key>/schema/‎). */
export function DataFormPage() {
  const { model = '', id = '' } = useParams()
  const creating = !id
  const schemaQuery = useDataSchema(model)
  const objectQuery = useDataObject(model, id, !creating)
  const meta: SchemaResponse | ObjectResponse | undefined = creating ? schemaQuery.data : objectQuery.data
  const isPending = creating ? schemaQuery.isPending : objectQuery.isPending
  const isError = creating ? schemaQuery.isError : objectQuery.isError
  // الـkey بيعيد بناء النموذج لما السجل يتغيّر (من غير ‎useEffect‎ لإعادة الضبط)
  return (
    <>
      <QueryState loading={isPending} error={isError} />
      {meta && <FormBody key={`${model}/${id}/${objectQuery.dataUpdatedAt}`} model={model} id={id} meta={meta} />}
    </>
  )
}

function FormBody({ model, id, meta }: { model: string; id: string; meta: SchemaResponse | ObjectResponse }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const creating = !id
  const object = 'values' in meta ? meta : null
  const [values, setValues] = useState<Values>(() => ({ ...(object ? object.values : (meta.defaults ?? {})) }))
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [files, setFiles] = useState<Record<string, File>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const top = useRef<HTMLDivElement>(null)
  // معاينة هيرو الرئيسية: الحقل الواقف عليه + اللغة/المظهر المعروضين
  const [focus, setFocus] = useState('')
  const [heroView, setHeroView] = useState<HeroView>({ lang: 'ar', theme: 'light' })
  const hasPreview = model === 'system.homehero'

  const title = object ? object.title : t('dataadmin.addNew', { name: meta.model.singular })
  usePageTitle(title)

  const byName = useMemo(() => new Map(meta.fields.map((field) => [field.name, field])), [meta.fields])
  const canSave = creating ? meta.perms.add : meta.perms.change

  useEffect(() => {
    const first = Object.keys(errors)[0]
    if (first) document.querySelector(`[data-field="${first}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [errors])

  const change = (name: string, value: FieldValue) => {
    setValues((now) => ({ ...now, [name]: value }))
    setDirty((now) => new Set(now).add(name))
    setErrors((now) => {
      if (!(name in now)) return now
      const rest = { ...now }
      delete rest[name]
      return rest
    })
  }
  const pickFile = (name: string, file: File | null) => {
    setFiles((now) => {
      const next = { ...now }
      if (file) next[name] = file
      else delete next[name]
      return next
    })
    setDirty((now) => new Set(now).add(name))
  }

  async function save(after: 'stay' | 'list' | 'new') {
    setBusy(true)
    setErrors({})
    try {
      const send: Values = {}
      for (const field of meta.fields) {
        if (field.kind === 'readonly') continue
        if (!creating && !dirty.has(field.name)) continue
        if (FILE_KINDS.has(field.kind)) {
          if (values[field.name] === null && !files[field.name]) send[field.name] = null
          continue
        }
        send[field.name] = values[field.name] === undefined ? '' : values[field.name]
      }
      const saved = await saveObject(model, creating ? null : id, send, files)
      await client.invalidateQueries({ queryKey: dataKeys.all })
      toast.success(t('dataadmin.saved', { name: saved.title }))
      if (after === 'list') navigate(`/dashboard/data/${model}`)
      else if (after === 'new') navigate(`/dashboard/data/${model}/new`)
      else if (creating) navigate(`/dashboard/data/${model}/${saved.id}`, { replace: true })
      else {
        setDirty(new Set())
        setFiles({})
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.fields) {
        setErrors(failure.fields)
        toast.error(failure.message || t('dataadmin.reviewData'))
      } else {
        toast.error(errorText(failure, t('dataadmin.saveFailed'), t('dataadmin.network')))
      }
    } finally {
      setBusy(false)
    }
  }

  const sections = meta.fieldsets.length > 0 ? meta.fieldsets : [{ title: '', description: '', fields: meta.fields.map((f) => f.name) }]
  const general = errors.__all__

  return (
    <>
      <PageHead title={title} subtitle={creating ? undefined : meta.model.singular}>
        <div className="da-head-actions">
          <Link className="btn btn--ghost btn--sm" to={`/dashboard/data/${model}`}>
            ← {meta.model.name}
          </Link>
        </div>
      </PageHead>
      <div ref={top} />
      {general && (
        <ul className="errorlist nonfield" role="alert">
          <li>{general}</li>
        </ul>
      )}
      <div className={hasPreview ? 'da-split' : undefined}>
      {hasPreview && (
        <HeroPreview
          values={values}
          files={files}
          focus={focus}
          focusLabel={byName.get(focus)?.label ?? ''}
          view={heroView}
          onView={setHeroView}
        />
      )}
      <form
        className="da-form"
        onFocusCapture={(event) => {
          if (!hasPreview) return
          const name = (event.target as HTMLElement).closest<HTMLElement>('[data-field]')?.dataset.field ?? ''
          setFocus(name)
          if (name) setHeroView((now) => viewForField(name, now))
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void save('stay')
        }}
      >
        {sections.map((section, index) => {
          // هيرو الرئيسية: الحقول اللي ليها علاقة باللغة والمظهر المختارين في المعاينة بس
          const names = section.fields.filter((name) => !hasPreview || heroFieldVisible(name, heroView))
          if (names.length === 0) return null
          return (
          <fieldset key={index} className="da-section card">
            {section.title && <legend>{section.title}</legend>}
            {section.description && <p className="muted">{section.description}</p>}
            {names.map((name) => {
              const info = byName.get(name)
              if (!info) return null
              return (
                <Row
                  key={name}
                  modelKey={model}
                  info={info}
                  value={values[name]}
                  error={errors[name]}
                  file={files[name]}
                  readonly={object?.readonly[name]}
                  onChange={(value) => change(name, value)}
                  onFile={(file) => pickFile(name, file)}
                  placeholder={hasPreview && !name.startsWith('bg_') ? String(i18n.t(`public.hero.${heroDefaultKey(name)}`, { lng: heroView.lang })) : undefined}
                />
              )
            })}
          </fieldset>
          )
        })}

        {object && object.inlines.map((inline) => (
          <section key={inline.title} className="da-section card">
            <h2>{inline.title}</h2>
            <Table head={inline.columns} empty={t('dataadmin.empty')} isEmpty={inline.rows.length === 0}>
              {inline.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <CellView cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          </section>
        ))}

        <div className="da-actions da-actions--sticky">
          {canSave && (
            <>
              <button className="btn btn--gold" type="submit" disabled={busy || (!creating && dirty.size === 0)}>
                {busy ? t('dataadmin.saving') : t('dataadmin.save')}
              </button>
              <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void save('list')}>
                {t('dataadmin.saveBack')}
              </button>
              {creating && (
                <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void save('new')}>
                  {t('dataadmin.saveNew')}
                </button>
              )}
            </>
          )}
          {!creating && meta.perms.delete && (
            <button className="btn btn--ghost btn--danger da-delete-btn" type="button" disabled={busy} onClick={() => setDeleting(true)}>
              {t('dataadmin.delete')}
            </button>
          )}
        </div>
      </form>
      </div>

      {!creating && model === 'auth.user' && meta.perms.change && <PasswordPanel id={id} />}

      {deleting && (
        <DeleteDialog
          modelKey={model}
          ids={[Number(id)]}
          onClose={() => setDeleting(false)}
          onDone={() => {
            toast.success(t('dataadmin.deleted', { count: 1 }))
            void client.invalidateQueries({ queryKey: dataKeys.all })
            navigate(`/dashboard/data/${model}`, { replace: true })
          }}
        />
      )}
    </>
  )
}
