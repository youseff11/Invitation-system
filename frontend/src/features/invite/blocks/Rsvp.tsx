import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ApiError, api } from '@/api/client'

import { useInvite } from '../context'
import { Lines } from '../Lines'
import { DividerOrnament } from '../svg'
import { Gate, Tail } from './Frame'
import { parseStyle } from '../style'
import type { BlockData, RsvpExtras } from '../types'

interface RsvpProps {
  heading?: string
  eyebrow?: string
  intro?: string
  name_label?: string
  phone_label?: string
  companions_label?: string
  message_label?: string
  status_label?: string
  attending_label?: string
  declined_label?: string
  maybe_label?: string
  submit_label?: string
  sent_label?: string
  success_message?: string
  wishes_heading?: string
  wishes_empty?: string
  closed_message?: string
  ask_status?: boolean
  ask_phone?: boolean
  phone_required?: boolean
  ask_companions?: boolean
  max_companions?: number
  ask_message?: boolean
  show_maybe?: boolean
  show_wishes?: boolean
}

interface PassInfo {
  code: string
  name: string
  entries: number
  url: string
  qr: string
  download: string
}

interface RsvpResponse {
  ok: boolean
  message?: string
  pass?: PassInfo
}

const AR_RE = /[؀-ۿ]/

/** تصريح الدخول بعد تأكيد الحضور: بنوريه في نفس الصفحة فوراً. */
function Pass({ info }: { info: PassInfo }) {
  const { t } = useInvite()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])
  return (
    <div className="lb-pass" data-rsvp-pass ref={ref}>
      <p className="lb-pass-title">{t('rsvp.passTitle')}</p>
      <img className="lb-pass-qr" src={info.qr} alt={t('rsvp.passAlt', { code: info.code || '' })} loading="lazy" />
      <p className="lb-pass-code">{info.code || ''}</p>
      <p className="lb-pass-note">
        {t(info.entries === 1 ? 'rsvp.passNoteOne' : 'rsvp.passNoteMany', { n: info.entries })}
      </p>
      <div className="lb-pass-actions">
        <a className="lb-btn lb-btn--solid" href={info.download} download="">
          {t('rsvp.passDownload')}
        </a>
        <a className="lb-btn" href={info.url} target="_blank" rel="noopener">
          {t('rsvp.passOpen')}
        </a>
      </div>
    </div>
  )
}

/** نموذج تأكيد الحضور — الأسئلة والمرافقين من إعدادات البلوك، والحدود على السيرفر. */
export function Rsvp({ block }: { block: BlockData }) {
  const { t, lang, demo } = useInvite()
  const p = block.props as RsvpProps
  const x = block.rsvp as RsvpExtras
  const guest = x.guest
  const answered = guest?.answered ?? null
  const isDemo = x.demo || demo

  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [pass, setPass] = useState<PassInfo | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const msgRef = useRef<HTMLParagraphElement>(null)

  const sentLabel = (() => {
    let sent = p.sent_label || ''
    // نص «بعد الإرسال» مش مترجَم؟ مانطلعش عربي في صفحة إنجليزي
    if (!sent || (lang === 'en' && AR_RE.test(sent))) sent = t('rsvp.sent')
    return sent
  })()

  const show = (text: string, ok: boolean) => {
    setMessage({ text, ok })
    window.setTimeout(() => msgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (phase !== 'idle') return
    // معاينة قالب: مفيش دعوة ورا الفورم — نفس شكل الإرسال الناجح
    if (isDemo) {
      setPhase('sent')
      show('', true)
      return
    }

    setPhase('sending')
    const fd = new FormData(e.currentTarget)
    const answers: Record<string, string | string[]> = {}
    for (const q of x.questions) {
      answers[q.name] = q.multiple ? (fd.getAll(q.name) as string[]) : String(fd.get(q.name) ?? '')
    }
    try {
      const res = await api<RsvpResponse>(x.action.replace(/^\/api\/v1/, ''), {
        method: 'POST',
        body: {
          name: fd.get('name') ?? '',
          phone: fd.get('phone') ?? '',
          status: fd.get('status') ?? 'attending',
          companions: fd.get('companions') ?? 0,
          message: fd.get('message') ?? '',
          website: fd.get('website') ?? '',
          answers,
          guestToken: guest?.token ?? '',
          lang,
        },
      })
      if (res.ok) {
        // رسالة السيرفر عربي والصفحة إنجليزي (ترجمة ناقصة)؟ نسيب رسالة الصفحة
        let ok = res.message || ''
        if (lang === 'en' && AR_RE.test(ok)) ok = ''
        setPhase('sent')
        show(ok, true)
        if (res.pass) setPass(res.pass)
      } else {
        setPhase('idle')
        show(t('rsvp.failed'), false)
      }
    } catch (err) {
      setPhase('idle')
      show(err instanceof ApiError ? err.message || t('rsvp.failed') : t('rsvp.connection'), false)
    }
  }

  const disabled = phase === 'sent'
  const msgText = message
    ? message.text ||
      (lang === 'en' && AR_RE.test(p.success_message || '')
        ? t('rsvp.thanks')
        : p.success_message || '')
    : p.success_message
  const { attrs } = block
  const companionsMax = guest ? guest.maxCompanions : Number(p.max_companions || 0)

  return (
    <section
      id={attrs.id}
      className={attrs.className}
      style={parseStyle(attrs.style)}
      data-block={block.id}
      data-block-type="rsvp"
    >
      <DividerOrnament variant={block.dividerTop} slot="ornament_top" />
      <div className="lb-inner">
        {p.eyebrow && (
          <p className="lb-eyebrow" data-ts="eyebrow">
            {p.eyebrow}
          </p>
        )}
        {p.heading && (
          <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
            {p.heading}
          </h2>
        )}
        {p.intro && (
          <p className="lb-body" data-ts="intro">
            <Lines text={p.intro} />
          </p>
        )}
        <div className="lb-card lb-rsvp" data-move="form">
          {x.closed ? (
            <p className="lb-rsvp-closed" data-ts="closed_message">
              {p.closed_message}
            </p>
          ) : (
            <>
              {guest && (
                <p className="lb-guest-hi">
                  {answered
                    ? t('rsvp.welcomeBack', { name: guest.name })
                    : t('rsvp.welcome', { name: guest.name })}
                </p>
              )}
              <form
                ref={formRef}
                className="lb-form"
                method="post"
                action={x.action || '#'}
                data-rsvp-form
                data-demo={isDemo ? '1' : undefined}
                onSubmit={submit}
              >
                <input type="text" name="website" className="lb-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
                <label className="lb-field">
                  {p.name_label && <span data-ts="name_label">{p.name_label}</span>}
                  <input
                    type="text"
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    defaultValue={guest?.name ?? ''}
                    disabled={disabled}
                  />
                </label>
                {p.ask_phone && (
                  <label className="lb-field">
                    {p.phone_label && <span data-ts="phone_label">{p.phone_label}</span>}
                    <input
                      type="tel"
                      name="phone"
                      maxLength={40}
                      autoComplete="tel"
                      required={Boolean(p.phone_required)}
                      defaultValue={guest?.phone ?? ''}
                      disabled={disabled}
                    />
                  </label>
                )}
                {p.ask_status === false ? (
                  <input type="hidden" name="status" value="attending" />
                ) : (
                  <div className="lb-field">
                    {p.status_label && <span data-ts="status_label">{p.status_label}</span>}
                    <div className="lb-choices">
                      <label>
                        <input
                          type="radio"
                          name="status"
                          value="attending"
                          defaultChecked={!answered || answered.status === 'attending'}
                          disabled={disabled}
                        />
                        <span data-ts="attending_label">{p.attending_label}</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="status"
                          value="declined"
                          defaultChecked={answered?.status === 'declined'}
                          disabled={disabled}
                        />
                        <span data-ts="declined_label">{p.declined_label}</span>
                      </label>
                      {p.show_maybe && (
                        <label>
                          <input
                            type="radio"
                            name="status"
                            value="maybe"
                            defaultChecked={answered?.status === 'maybe'}
                            disabled={disabled}
                          />
                          <span data-ts="maybe_label">{p.maybe_label}</span>
                        </label>
                      )}
                    </div>
                  </div>
                )}
                {p.ask_companions && (!guest || guest.maxCompanions > 0) && (
                  <label className="lb-field">
                    <span data-ts="companions_label">
                      {p.companions_label}
                      {guest && (
                        <>
                          {' '}
                          <small>
                            ({t('rsvp.upTo')} {guest.maxCompanions})
                          </small>
                        </>
                      )}
                    </span>
                    <input
                      type="number"
                      name="companions"
                      min={0}
                      max={companionsMax}
                      defaultValue={guest ? answered?.companions || 0 : 0}
                      inputMode="numeric"
                      disabled={disabled}
                    />
                  </label>
                )}
                {p.ask_message && (
                  <label className="lb-field">
                    {p.message_label && <span data-ts="message_label">{p.message_label}</span>}
                    <textarea
                      name="message"
                      rows={3}
                      maxLength={600}
                      defaultValue={answered?.message ?? ''}
                      disabled={disabled}
                    />
                  </label>
                )}
                {x.questions.map((q) => (
                  <div className="lb-field lb-q" key={q.name}>
                    <span>
                      {q.label}
                      {q.required && (
                        <>
                          {' '}
                          <em className="lb-q-req">*</em>
                        </>
                      )}
                    </span>
                    {q.hint && <small className="lb-q-hint">{q.hint}</small>}
                    {q.kind === 'choice' ? (
                      <div className="lb-choices">
                        {q.options.map((o, i) => (
                          <label key={o.label}>
                            <input
                              type={q.multiple ? 'checkbox' : 'radio'}
                              name={q.name}
                              value={o.label}
                              defaultChecked={o.checked}
                              required={q.required && !q.multiple && i === 0}
                              disabled={disabled}
                            />
                            <span>{o.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : q.kind === 'textarea' ? (
                      <textarea
                        name={q.name}
                        rows={3}
                        maxLength={600}
                        required={q.required}
                        defaultValue={q.value}
                        disabled={disabled}
                      />
                    ) : (
                      <input
                        type="text"
                        name={q.name}
                        maxLength={200}
                        required={q.required}
                        defaultValue={q.value}
                        disabled={disabled}
                      />
                    )}
                  </div>
                ))}
                <button
                  type="submit"
                  className={`lb-btn lb-btn--solid lb-btn--block${phase === 'sent' ? ' is-sent' : ''}`}
                  data-ts="submit_label"
                  data-sent-label={p.sent_label || 'تم الإرسال ✓'}
                  disabled={phase !== 'idle'}
                >
                  {phase === 'sending' ? t('rsvp.sending') : phase === 'sent' ? sentLabel : p.submit_label}
                </button>
                <p
                  ref={msgRef}
                  className="lb-form-msg"
                  data-rsvp-msg
                  hidden={!message}
                  data-ts="success_message"
                  style={message && !message.ok ? { background: 'rgba(180,65,60,.12)', color: '#b4413c' } : undefined}
                >
                  {msgText}
                </p>
                {pass && <Pass info={pass} />}
                {phase === 'sent' && isDemo && (
                  <p className="lb-form-note" data-rsvp-demo-note>
                    {t('rsvp.demoNote')}
                  </p>
                )}
              </form>
            </>
          )}
        </div>
        {p.show_wishes && (
          <div className="lb-card lb-rsvp-wishes" data-move="wishes">
            {p.wishes_heading && (
              <p className="lb-rsvp-wishes-title" data-ts="wishes_heading">
                {p.wishes_heading}
              </p>
            )}
            <div className="lb-rsvp-wishes-list">
              {x.wishes.length ? (
                x.wishes.map((w, i) => (
                  <article className="lb-rsvp-wish" key={i}>
                    <p>{w.message}</p>
                    <cite>{w.name}</cite>
                  </article>
                ))
              ) : (
                <p className="lb-rsvp-wishes-empty" data-ts="wishes_empty">
                  {p.wishes_empty}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <DividerOrnament variant={block.dividerBottom} slot="ornament_bottom" />
      <Gate block={block} />
      <Tail block={block} />
    </section>
  )
}
