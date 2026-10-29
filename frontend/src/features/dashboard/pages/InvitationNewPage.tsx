import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { appPath } from '@/lib/appPath'
import { useCreateInvitation, useInvitationOptions } from '../api'
import type { InvitationCreateBody } from '../types'
import { SelectField, TextField, useFormErrors } from '../ui/forms'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState } from '../ui/table'
import { useToast } from '../ui/Toast'

const text = (values: FormData, key: string) => String(values.get(key) ?? '')

/** إنشاء دعوة: قالب ← باقة ← عميل وأسماء، وبعدها المحرر (‎templates/dashboard/invitation_create.html‎). */
export function InvitationNewPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const toast = useToast()
  const { data: site } = useSite()
  const { data, isPending, isError } = useInvitationOptions()
  const create = useCreateInvitation()
  const navigate = useNavigate()
  const errors = useFormErrors()
  usePageTitle(t('dashboard.invitationNew.pageTitle'))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const body: InvitationCreateBody = {
      templateId: text(values, 'templateId'),
      planId: text(values, 'planId'),
      customerId: text(values, 'customerId'),
      customerName: text(values, 'customerName'),
      customerPhone: text(values, 'customerPhone'),
      customerEmail: text(values, 'customerEmail'),
      nameOne: text(values, 'nameOne'),
      nameTwo: text(values, 'nameTwo'),
      eventType: text(values, 'eventType'),
    }
    errors.clear()
    create.mutate(body, {
      onSuccess: (created) => {
        navigate(appPath(created.editorUrl))
      },
      onError: (error) => {
        errors.fail(error)
        toast.fail(error)
      },
    })
  }

  return (
    <>
      <PageHead title={t('dashboard.invitationNew.title')} />
      <QueryState loading={isPending} error={isError} />
      {data && (
        <form className="card" style={{ maxWidth: 820 }} onSubmit={onSubmit}>
          <h3>{t('dashboard.invitationNew.step1')}</h3>
          <div className="grid grid--4" style={{ marginBottom: 22 }}>
            {data.templates.map((template, index) => (
              <label className="tpl-card" style={{ cursor: 'pointer' }} key={template.id}>
                <div
                  className="tpl-cover"
                  style={template.cover ? { backgroundImage: `url('${template.cover}')` } : undefined}
                >
                  {!template.cover && template.name.slice(0, 1)}
                </div>
                <div className="tpl-body">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    <input type="radio" name="templateId" value={template.id} required defaultChecked={index === 0} />
                    {template.name}
                    {!template.isActive && <Pill kind="archived">{t('dashboard.common.hidden')}</Pill>}
                  </div>
                </div>
              </label>
            ))}
            {data.templates.length === 0 && <p className="empty">{t('dashboard.invitationNew.noTemplates')}</p>}
          </div>
          {errors.fields.templateId && <p className="errorlist">{errors.fields.templateId}</p>}

          <h3>{t('dashboard.invitationNew.step2')}</h3>
          <div className="form form--2" style={{ marginBottom: 22 }}>
            <SelectField
              name="planId"
              label={
                <>
                  {t('dashboard.invitationNew.plan')} <small className="muted">{t('dashboard.common.optional')}</small>
                </>
              }
              error={errors.fields.planId}
            >
              <option value="">{t('dashboard.invitationNew.noPlan')}</option>
              {data.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.price} {site?.currency}
                </option>
              ))}
            </SelectField>
            <SelectField name="eventType" label={t('dashboard.invitationNew.eventType')}>
              {data.eventTypes.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {labels.eventType(eventType)}
                </option>
              ))}
            </SelectField>
          </div>

          <h3>{t('dashboard.invitationNew.step3')}</h3>
          <div className="form form--2">
            <SelectField name="customerId" label={t('dashboard.invitationNew.existingCustomer')}>
              <option value="">{t('dashboard.invitationNew.newCustomer')}</option>
              {data.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.phone}
                </option>
              ))}
            </SelectField>
            <TextField
              name="customerName"
              label={t('dashboard.invitationNew.customerName')}
              error={errors.fields.customerName}
            />
            <TextField name="customerPhone" label={t('dashboard.invitationNew.customerPhone')} />
            <TextField name="customerEmail" type="email" label={t('dashboard.invitationNew.customerEmail')} />
            <TextField name="nameOne" label={t('dashboard.invitationNew.nameOne')} placeholder={t('dashboard.invitationNew.nameOnePlaceholder')} />
            <TextField name="nameTwo" label={t('dashboard.invitationNew.nameTwo')} placeholder={t('dashboard.invitationNew.nameTwoPlaceholder')} />
            <div className="span-2">
              <button className="btn btn--gold btn--block" type="submit" disabled={create.isPending}>
                {t('dashboard.invitationNew.submit')}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  )
}
