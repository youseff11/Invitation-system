import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { EventFields } from '../types'
import { useEditorUi } from '../ui'
import { useOpenGroups } from './FieldGroups'
import { cleanSlug, copyText, SLUG_MIN } from './slug'

interface RowProps {
  name: keyof EventFields
  label: string
  type?: 'text' | 'url' | 'datetime-local'
  hint?: string
  /** أرقام وروابط: اتجاه شمال-يمين حتى في الواجهة العربية */
  ltr?: boolean
}

/** حقل من بيانات المناسبة: بيقرا ويكتب في ‎store.fields‎ ويعرض خطأ التحقق بتاع آخر حفظ تحته. */
function EventRow({ name, label, type = 'text', hint, ltr }: RowProps) {
  const id = useId()
  const value = useEditor((s) => s.fields?.[name] ?? '')
  const error = useEditor((s) => s.fieldErrors[name])
  const setEventField = useEditor((s) => s.setEventField)
  return (
    <div className="ed-field" data-event-field={name}>
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        className="ed-input"
        type={type}
        dir={ltr ? 'ltr' : undefined}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setEventField(name, e.target.value)}
      />
      {hint && <small>{hint}</small>}
      {error && (
        <small className="ed-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

function StatusRow() {
  const { t } = useTranslation()
  const id = useId()
  const value = useEditor((s) => s.fields?.status ?? '')
  const choices = useEditor((s) => s.statusChoices)
  const error = useEditor((s) => s.fieldErrors.status)
  const setEventField = useEditor((s) => s.setEventField)
  // حالة محفوظة مش في الخيارات (سيرفر أقدم) ماتتمسحش بصمت
  const options = choices.some((c) => c.value === value) || !value ? choices : [...choices, { value, label: value }]
  return (
    <div className="ed-field" data-event-field="status">
      <label htmlFor={id}>
        <span>{t('editorSettings.data.fields.status')}</span>
      </label>
      <select id={id} className="ed-input" value={value} onChange={(e) => setEventField('status', e.target.value)}>
        {options.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {error && (
        <small className="ed-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

/** ينتظر انتهاء حفظة شغالة (تلقائية مثلاً) وبعدين يحفظ — ‎save()‎ بترجع ‎false‎ من غير ما تحفظ لو فيه حفظة جارية. */
async function saveWhenIdle(): Promise<boolean> {
  const editor = useEditor.getState()
  if (editor.saveStatus === 'saving') {
    await new Promise<void>((resolve) => {
      const off = useEditor.subscribe((state) => {
        if (state.saveStatus === 'saving') return
        off()
        resolve()
      })
    })
  }
  return useEditor.getState().save()
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return window.location.host
  }
}

/**
 * رابط الدعوة (‎bindSlugField‎ في القديم): الخانة الظاهرة مسودة بس، والرابط الفعلي بيتغيّر بزرار «تغيير الرابط»
 * بعد تأكيد ويتحفظ فوراً — عشان الحفظ التلقائي ماغيّرش الرابط مع كل حرف وانت لسه بتكتب.
 */
function SlugRow() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const id = useId()
  const slug = useEditor((s) => s.fields?.slug ?? '')
  const publicUrl = useEditor((s) => s.meta?.publicUrl ?? '')
  const storeError = useEditor((s) => s.fieldErrors.slug)
  const setEventField = useEditor((s) => s.setEventField)
  const [draft, setDraft] = useState(slug)
  const [failure, setFailure] = useState('')
  const [applying, setApplying] = useState(false)

  // السيرفر ممكن ينضّف الرابط عند الحفظ: الخانة تعرض الرابط الفعلي
  const [seen, setSeen] = useState(slug)
  if (seen !== slug) {
    setSeen(slug)
    setDraft(slug)
  }

  const apply = async () => {
    const value = cleanSlug(draft)
    setDraft(value)
    setFailure('')
    if (value.length < SLUG_MIN) return ui.toast(t('editorSettings.data.slug.tooShort'), 'error')
    if (value === slug) return ui.toast(t('editorSettings.data.slug.same'), 'ok')
    if (!(await ui.confirm(t('editorSettings.data.slug.confirm', { slug: value })))) return

    const previous = slug
    const before = useEditor.getState()
    const wasClean = before.saveStatus === 'saved'
    setApplying(true)
    setEventField('slug', value)
    const ok = await saveWhenIdle()
    setApplying(false)
    if (ok) return ui.toast(t('editorSettings.data.slug.changed'), 'ok')
    // الرابط الجديد ماتحفظش (مكرر/محجوز…): نرجّع القديم عشان باقي الحفظات ماتفشلش بسببه
    setFailure(useEditor.getState().fieldErrors.slug ?? '')
    setEventField('slug', previous)
    setDraft(previous)
    // كان كل حاجة محفوظة قبل المحاولة ومفيش تعديل تاني دخل (تغيير + رجوع = تعديلين): مفيش حاجة غير محفوظة
    if (wasClean && useEditor.getState().rev === before.rev + 2) useEditor.setState({ saveStatus: 'saved' })
  }

  const error = failure || storeError
  return (
    <div className="ed-field" data-event-field="slug">
      <label htmlFor={id}>
        <span>{t('editorSettings.data.fields.slug')}</span>
      </label>
      <div className="ed-slug-row">
        <span className="ed-slug-prefix" dir="ltr">
          {hostOf(publicUrl)}/i/
        </span>
        <input
          id={id}
          className="ed-input ed-slug-input"
          dir="ltr"
          maxLength={60}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('editorSettings.data.slug.placeholder')}
          value={draft}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            setFailure('')
          }}
          // التنضيف وقت الخروج من الحقل مش مع كل حرف عشان «-» تتكتب عادي
          onBlur={() => setDraft((current) => cleanSlug(current))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void apply()
          }}
        />
      </div>
      <div className="ed-field-actions">
        <button type="button" className="ed-btn ed-btn--sm ed-btn--primary" disabled={applying} onClick={() => void apply()}>
          {t('editorSettings.data.slug.apply')}
        </button>
        <CopyButton text={publicUrl} label={t('editorSettings.data.slug.copy')} />
      </div>
      <small>{t('editorSettings.data.slug.hint')}</small>
      {error && (
        <small className="ed-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  return (
    <button
      type="button"
      className="ed-btn ed-btn--sm"
      disabled={!text}
      onClick={async () => ui.toast(t((await copyText(text)) ? 'editorSettings.data.copied' : 'editorSettings.data.copyFailed'), 'ok')}
    >
      {label}
    </button>
  )
}

function ReadonlyUrl({ label, value, children, hint }: { label: string; value: string; children?: ReactNode; hint?: string }) {
  const id = useId()
  return (
    <div className="ed-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <input id={id} className="ed-input" readOnly dir="ltr" value={value} onFocus={(e) => e.currentTarget.select()} />
      {children && <div className="ed-field-actions">{children}</div>}
      {hint && <small>{hint}</small>}
    </div>
  )
}

function Group({ name, title, open, onToggle, defaultOpen, children }: {
  name: string
  title: string
  open: Record<string, boolean>
  onToggle: (name: string, open: boolean) => void
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className="ed-group" open={open[name] ?? !!defaultOpen} onToggle={(e) => onToggle(name, e.currentTarget.open)}>
      <summary>
        <span>{title}</span>
      </summary>
      <div className="ed-group-body">{children}</div>
    </details>
  )
}

/** تبويب البيانات (دعوة بس): بيانات المناسبة اللي بتملأ الأقسام تلقائياً + النشر والروابط. */
export function DataPanel() {
  const { t } = useTranslation()
  const hasFields = useEditor((s) => !!s.fields)
  const meta = useEditor((s) => s.meta)
  const groups = useOpenGroups()
  const label = (key: keyof EventFields | 'publicUrl' | 'followupUrl') => t(`editorSettings.data.fields.${key}`)
  if (!hasFields) return null

  const group = { open: groups.open, onToggle: groups.onToggle }
  return (
    <>
      <p className="ed-kicker">{t('editorSettings.data.kicker')}</p>
      <p className="ed-hint">{t('editorSettings.data.hint')}</p>

      <Group name="basics" title={t('editorSettings.data.groups.basics')} defaultOpen {...group}>
        <EventRow name="title" label={label('title')} />
        <EventRow name="eventType" label={label('eventType')} />
        <EventRow name="nameOne" label={label('nameOne')} />
        <EventRow name="nameTwo" label={label('nameTwo')} />
        <EventRow name="eventDate" label={label('eventDate')} type="datetime-local" ltr />
      </Group>

      <Group name="place" title={t('editorSettings.data.groups.place')} {...group}>
        <EventRow name="venue" label={label('venue')} />
        <EventRow name="address" label={label('address')} />
        <EventRow name="mapUrl" label={label('mapUrl')} type="url" ltr />
        <EventRow name="whatsapp" label={label('whatsapp')} ltr />
      </Group>

      <Group name="publish" title={t('editorSettings.data.groups.publish')} {...group}>
        <StatusRow />
        <EventRow name="password" label={label('password')} hint={t('editorSettings.data.passwordHint')} />
        <EventRow name="expiresAt" label={label('expiresAt')} type="datetime-local" ltr />
        <SlugRow />
        <ReadonlyUrl label={label('publicUrl')} value={meta?.publicUrl ?? ''} />
        <ReadonlyUrl label={label('followupUrl')} value={meta?.clientFollowupUrl ?? ''} hint={t('editorSettings.data.followup.hint')}>
          <CopyButton text={meta?.clientFollowupUrl ?? ''} label={t('editorSettings.data.followup.copy')} />
          {meta?.clientFollowupUrl && (
            <a className="ed-btn ed-btn--sm" href={meta.clientFollowupUrl} target="_blank" rel="noopener">
              {t('editorSettings.data.followup.open')}
            </a>
          )}
        </ReadonlyUrl>
      </Group>
    </>
  )
}
