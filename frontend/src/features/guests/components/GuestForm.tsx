import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'
import { useCreateGuest, useUpdateGuest } from '../api'
import type { GuestInput, GuestRow } from '../types'

const EMPTY: GuestInput = { name: '', phone: '', groupName: '', plusOnesAllowed: 0, note: '' }

// أسماء الحقول في أخطاء الفورم (Django) → مفاتيح الحالة
const ERROR_KEYS: Record<keyof GuestInput, string> = {
  name: 'name',
  phone: 'phone',
  groupName: 'group_name',
  plusOnesAllowed: 'plus_ones_allowed',
  note: 'note',
}

interface Props {
  invitationId: string
  /** الضيف اللي بيتعدّل دلوقتي، أو null للإضافة (الأب بيحط ‎key‎ مختلف لكل ضيف عشان الحقول تتصفّر). */
  editing: GuestRow | null
  onDone: (message: string) => void
  onCancel: () => void
}

function inputFor(guest: GuestRow | null): GuestInput {
  return guest
    ? {
        name: guest.name,
        phone: guest.phone,
        groupName: guest.groupName,
        plusOnesAllowed: guest.plusOnesAllowed,
        note: guest.note,
      }
    : EMPTY
}

/** نفس حقول ‎GuestForm‎: الاسم، الهاتف، المجموعة، المرافقون، الملاحظة. */
export function GuestForm({ invitationId, editing, onDone, onCancel }: Props) {
  const { t } = useTranslation()
  const create = useCreateGuest(invitationId)
  const update = useUpdateGuest(invitationId)
  const [values, setValues] = useState<GuestInput>(() => inputFor(editing))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')

  const pending = create.isPending || update.isPending

  function field(key: keyof GuestInput) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value
      const value = key === 'plusOnesAllowed' ? (raw === '' ? '' : Number(raw)) : raw
      setValues((current) => ({ ...current, [key]: value }))
    }
  }

  function fail(error: unknown) {
    if (error instanceof ApiError) {
      setErrors(error.fields ?? {})
      setFailure(error.fields ? '' : error.message || t('errors.generic'))
    } else {
      setFailure(t('errors.network'))
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setErrors({})
    setFailure('')
    if (editing) {
      update.mutate(
        { id: editing.id, input: values },
        { onSuccess: () => onDone(t('guests.flash.updated')), onError: fail },
      )
    } else {
      create.mutate(values, {
        onSuccess: () => {
          setValues(EMPTY)
          onDone(t('guests.flash.added'))
        },
        onError: fail,
      })
    }
  }

  const rows: { key: keyof GuestInput; label: string; type?: string; max?: number }[] = [
    { key: 'name', label: t('guests.form.name'), max: 120 },
    { key: 'phone', label: t('guests.form.phone'), max: 40 },
    { key: 'groupName', label: t('guests.form.group'), max: 80 },
    { key: 'plusOnesAllowed', label: t('guests.form.plusOnes'), type: 'number' },
    { key: 'note', label: t('guests.form.note'), max: 250 },
  ]

  return (
    <div className="gw-card">
      <h3>{editing ? t('guests.form.editTitle') : t('guests.form.addTitle')}</h3>
      <form className="gw-form" onSubmit={submit} noValidate>
        {rows.map(({ key, label, type, max }) => {
          const error = errors[ERROR_KEYS[key]]
          const id = `guest-form-${key}`
          return (
            <div className="gw-field" key={key}>
              <label htmlFor={id}>{label}</label>
              <input
                id={id}
                name={key}
                type={type ?? 'text'}
                value={values[key]}
                onChange={field(key)}
                maxLength={max}
                min={type === 'number' ? 0 : undefined}
                max={type === 'number' ? 20 : undefined}
                aria-invalid={error ? true : undefined}
              />
              {error && <ul className="gw-errors"><li>{error}</li></ul>}
            </div>
          )
        })}
        {failure && (
          <p className="flash flash--error" role="alert">
            {failure}
          </p>
        )}
        <button className="btn btn--gold btn--block" type="submit" disabled={pending}>
          {editing ? t('guests.form.save') : t('guests.form.add')}
        </button>
        {editing && (
          <button className="btn btn--ghost btn--block" type="button" onClick={onCancel}>
            {t('guests.form.cancel')}
          </button>
        )}
      </form>
    </div>
  )
}
