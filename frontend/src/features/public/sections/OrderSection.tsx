import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'
import type { SiteInfo } from '@/api/types'
import { useCreateOrder, useOrderFormOptions } from '../hooks'
import { pick, useLang } from '../text'
import type { OrderPayload } from '../types'

interface FormState {
  customerName: string
  customerPhone: string
  customerEmail: string
  plan: string
  template: string
  /** ‎null‎ = لسه ما اتلمسش، فبنعرض القيمة الافتراضية من السيرفر */
  eventType: string | null
  eventDate: string
  names: string
  message: string
  addons: number[]
}

const EMPTY: FormState = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  plan: '',
  template: '',
  eventType: null,
  eventDate: '',
  names: '',
  message: '',
  addons: [],
}

function Field({
  label,
  htmlFor,
  error,
  wide,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={'field' + (wide ? ' span-2' : '')}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && (
        <ul className="errorlist">
          <li>{error}</li>
        </ul>
      )}
    </div>
  )
}

/**
 * نموذج «اطلب دعوتك» — بيطابق ‎OrderForm‎ في السيرفر (نفس الحقول والتحقق؛ الرسائل
 * جاية من السيرفر). الإضافة المربوطة بباقات معيّنة بتختفي لما تختار باقة تانية
 * وبنشيل علامتها، وتحت الاختيارات إجمالي حيّ — زي ‎site.js‎ القديم.
 * بيشتغل بس لما الطلبات مفعّلة؛ السيرفر بيرفض أي إرسال لو مقفولة.
 */
export function OrderSection({ site }: { site: SiteInfo }) {
  const { t } = useTranslation()
  const lang = useLang()
  const options = useOrderFormOptions(site.ordersEnabled)
  const create = useCreateOrder()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [sent, setSent] = useState(false)

  const data = options.data
  const planId = form.plan ? Number(form.plan) : null
  const visibleAddons = (data?.addons ?? []).filter(
    (addon) => addon.planIds.length === 0 || (planId !== null && addon.planIds.includes(planId)),
  )
  // اختيارات إضافة اتخفت (باقة تانية) مابتتبعتش
  const chosen = visibleAddons.filter((addon) => form.addons.includes(addon.id))
  const total = chosen.reduce((sum, addon) => sum + addon.price, 0)

  const error = create.error
  const fieldErrors = error instanceof ApiError ? (error.fields ?? {}) : {}

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleAddon(id: number, checked: boolean) {
    setForm((current) => ({
      ...current,
      addons: checked ? [...current.addons, id] : current.addons.filter((existing) => existing !== id),
    }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const payload: OrderPayload = {
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerEmail: form.customerEmail,
      plan: planId,
      template: form.template ? Number(form.template) : null,
      eventType: form.eventType ?? data?.defaultEventType ?? '',
      eventDate: form.eventDate,
      names: form.names,
      message: form.message,
      addons: chosen.map((addon) => addon.id),
    }
    setSent(false)
    create.mutate(payload, {
      onSuccess: () => {
        setSent(true)
        setForm(EMPTY)
      },
    })
  }

  const id = (name: string) => `order-${name}`
  const errorOf = (name: string) => fieldErrors[name]

  return (
    <section className="section section--alt" id="order">
      <div className="wrap order-section-wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.order.eyebrow')}</p>
          <h2>{t('public.order.title')}</h2>
          <p>{t('public.order.sub')}</p>
        </div>

        {sent && (
          <div className="flash flash--success" role="status">
            {t('public.order.success')}
          </div>
        )}
        {!!error && (
          <div className="flash flash--error" role="alert">
            {error instanceof ApiError && error.status === 400
              ? t('public.order.invalid')
              : error instanceof ApiError && error.message
                ? error.message
                : t('public.order.networkError')}
          </div>
        )}

        <form className="form form--2 card" onSubmit={submit}>
          <Field label={t('public.order.customerName')} htmlFor={id('name')} error={errorOf('customerName')}>
            <input
              id={id('name')}
              name="customer_name"
              maxLength={120}
              required
              value={form.customerName}
              onChange={(e) => set('customerName', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.customerPhone')} htmlFor={id('phone')} error={errorOf('customerPhone')}>
            <input
              id={id('phone')}
              name="customer_phone"
              type="tel"
              maxLength={40}
              required
              value={form.customerPhone}
              onChange={(e) => set('customerPhone', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.customerEmail')} htmlFor={id('email')} error={errorOf('customerEmail')}>
            <input
              id={id('email')}
              name="customer_email"
              type="email"
              value={form.customerEmail}
              onChange={(e) => set('customerEmail', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.plan')} htmlFor={id('plan')} error={errorOf('plan')}>
            <select
              id={id('plan')}
              name="plan"
              required
              value={form.plan}
              onChange={(e) => set('plan', e.target.value)}
            >
              <option value="">{t('public.order.choosePlan')}</option>
              {data?.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {pick(lang, plan.name, plan.nameEn)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('public.order.template')} htmlFor={id('template')} error={errorOf('template')}>
            <select
              id={id('template')}
              name="template"
              value={form.template}
              onChange={(e) => set('template', e.target.value)}
            >
              <option value="">{t('public.order.noTemplate')}</option>
              {data?.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {pick(lang, template.name, template.nameEn)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('public.order.eventType')} htmlFor={id('event-type')} error={errorOf('eventType')}>
            <input
              id={id('event-type')}
              name="event_type"
              maxLength={50}
              required
              value={form.eventType ?? data?.defaultEventType ?? ''}
              onChange={(e) => set('eventType', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.eventDate')} htmlFor={id('event-date')} error={errorOf('eventDate')}>
            <input
              id={id('event-date')}
              name="event_date"
              type="date"
              value={form.eventDate}
              onChange={(e) => set('eventDate', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.names')} htmlFor={id('names')} error={errorOf('names')} wide>
            <input
              id={id('names')}
              name="names"
              maxLength={200}
              value={form.names}
              onChange={(e) => set('names', e.target.value)}
            />
          </Field>
          <Field label={t('public.order.message')} htmlFor={id('message')} error={errorOf('message')} wide>
            <textarea
              id={id('message')}
              name="message"
              rows={3}
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
            />
          </Field>

          {visibleAddons.length > 0 && (
            <div className="field span-2">
              <label>{t('public.order.addons')}</label>
              <div className="addons">
                {visibleAddons.map((addon) => (
                  <label className="addon" key={addon.id}>
                    <input
                      type="checkbox"
                      name="addons"
                      value={addon.id}
                      checked={form.addons.includes(addon.id)}
                      onChange={(e) => toggleAddon(addon.id, e.target.checked)}
                    />
                    <span className="addon-body">
                      <span className="addon-name">{pick(lang, addon.name, addon.nameEn)}</span>
                      {addon.description && <span className="addon-desc">{addon.description}</span>}
                    </span>
                    <span className="addon-price">
                      +{addon.price} {site.currency}
                    </span>
                  </label>
                ))}
              </div>
              {total > 0 && (
                <p className="addons-total">
                  {t('public.order.addonsTotal', { total, currency: site.currency })}
                </p>
              )}
              {errorOf('addons') && (
                <ul className="errorlist">
                  <li>{errorOf('addons')}</li>
                </ul>
              )}
            </div>
          )}

          <div className="span-2">
            <button className="btn btn--gold btn--block" type="submit" disabled={create.isPending}>
              {create.isPending ? t('public.order.sending') : t('public.order.send')}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
