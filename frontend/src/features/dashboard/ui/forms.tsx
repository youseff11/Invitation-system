import { useCallback, useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'

/** أخطاء نموذج جاية من الـAPI: ‎fields‎ لكل حقل، و‎__all__‎ لأخطاء النموذج نفسه. */
export function useFormErrors() {
  const [fields, setFields] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const clear = useCallback(() => {
    setFields({})
    setFormError('')
  }, [])

  /** يرجّع ‎true‎ لو الخطأ خطأ تحقق (اتعرض تحت الحقول). */
  const fail = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.code === 'validation_error') {
      const { __all__: all, ...rest } = error.fields ?? {}
      setFields(rest)
      setFormError(all ?? '')
      return true
    }
    setFields({})
    setFormError('')
    return false
  }, [])

  return { fields, formError, fail, clear }
}

export function ErrorList({ message, nonField }: { message?: string; nonField?: boolean }) {
  if (!message) return null
  return (
    <ul className={nonField ? 'errorlist nonfield' : 'errorlist'}>
      <li>{message}</li>
    </ul>
  )
}

interface FieldProps {
  id: string
  label: ReactNode
  help?: ReactNode
  /** نص المساعدة بحجم ١٢px (زي نماذج الموسيقى والإعدادات) بدل الحجم الافتراضي. */
  helpSmall?: boolean
  error?: string
  className?: string
  children: ReactNode
}

/** ‎<div class="field">‎ — التسمية فوق، والمساعدة والأخطاء تحت (نفس ترتيب نماذج Django). */
export function Field({ id, label, help, helpSmall, error, className, children }: FieldProps) {
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && (
        <small className="muted" style={helpSmall ? { fontSize: 12 } : undefined}>
          {help}
        </small>
      )}
      <ErrorList message={error} />
    </div>
  )
}

type CommonProps = {
  name: string
  label: ReactNode
  help?: ReactNode
  helpSmall?: boolean
  error?: string
  className?: string
}

export function TextField({
  name,
  label,
  help,
  helpSmall,
  error,
  className,
  ...input
}: CommonProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} help={help} helpSmall={helpSmall} error={error} className={className}>
      <input id={id} name={name} type="text" {...input} />
    </Field>
  )
}

export function TextAreaField({
  name,
  label,
  help,
  helpSmall,
  error,
  className,
  ...input
}: CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} help={help} helpSmall={helpSmall} error={error} className={className}>
      <textarea id={id} name={name} {...input} />
    </Field>
  )
}

export function SelectField({
  name,
  label,
  help,
  helpSmall,
  error,
  className,
  children,
  ...input
}: CommonProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} help={help} helpSmall={helpSmall} error={error} className={className}>
      <select id={id} name={name} {...input}>
        {children}
      </select>
    </Field>
  )
}

/** مربّع اختيار جنب كلامه (‎.field--check‎). */
export function CheckField({
  name,
  label,
  className,
  ...input
}: { name: string; label: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId()
  return (
    <label className={className ? `field field--check ${className}` : 'field field--check'} htmlFor={id}>
      <input id={id} name={name} type="checkbox" {...input} />
      <span>{label}</span>
    </label>
  )
}

interface FileFieldProps extends CommonProps {
  accept?: string
  /** أقصى حجم بالبايت — الملف الأكبر بيترفض فوراً من غير ما يتبعت. */
  maxBytes?: number
  required?: boolean
}

/** حقل رفع ملف مع فحص الحجم قبل الإرسال (السيرفر بيفحص تاني بنفس الحد). */
export function FileField({
  name,
  label,
  help,
  helpSmall,
  error,
  className,
  accept,
  maxBytes,
  required,
}: FileFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const [tooLarge, setTooLarge] = useState('')

  return (
    <Field id={id} label={label} help={help} helpSmall={helpSmall} error={tooLarge || error} className={className}>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file && maxBytes && file.size > maxBytes) {
            setTooLarge(t('dashboard.errors.fileTooLarge', { mb: Math.round(maxBytes / (1024 * 1024)) }))
            event.currentTarget.value = ''
          } else {
            setTooLarge('')
          }
        }}
      />
    </Field>
  )
}

export const MB = 1024 * 1024
