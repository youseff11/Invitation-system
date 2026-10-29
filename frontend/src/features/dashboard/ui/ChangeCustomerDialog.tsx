import { useEffect } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useChangeInvitationCustomer, useInvitationOptions } from '../api'
import type { InvitationRow } from '../types'
import { SelectField, TextField, useFormErrors } from './forms'
import { useToast } from './Toast'

const text = (values: FormData, key: string) => String(values.get(key) ?? '')

/** نافذة تغيير عميل دعوة: عميل موجود، أو تعديل الاسم/الهاتف (‎POST /dashboard/invitations/:id/customer/‎). */
export function ChangeCustomerDialog({ invitation, onClose }: { invitation: InvitationRow; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const options = useInvitationOptions()
  const change = useChangeInvitationCustomer()
  const errors = useFormErrors()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    errors.clear()
    change.mutate(
      {
        id: invitation.id,
        body: {
          customerId: text(values, 'customerId'),
          customerName: text(values, 'customerName'),
          customerPhone: text(values, 'customerPhone'),
          customerEmail: '',
        },
      },
      {
        onSuccess: (done) => {
          toast.success(t('dashboard.invitations.changeCustomer.saved', { title: invitation.title, name: done.customerName }))
          onClose()
        },
        onError: (error) => {
          if (!errors.fail(error)) toast.fail(error)
        },
      },
    )
  }

  return (
    <div
      className="dash-dialog-veil"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="dash-dialog form"
        role="dialog"
        aria-modal="true"
        aria-label={t('dashboard.invitations.changeCustomer.title', { title: invitation.title })}
        onSubmit={onSubmit}
      >
        <h3 style={{ margin: 0 }}>{t('dashboard.invitations.changeCustomer.title', { title: invitation.title })}</h3>
        <SelectField
          name="customerId"
          label={t('dashboard.invitations.changeCustomer.existing')}
          error={errors.fields.customerId}
          defaultValue=""
        >
          <option value="">{t('dashboard.invitations.changeCustomer.keepEditing')}</option>
          {options.data?.customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name} · {customer.phone}
            </option>
          ))}
        </SelectField>
        <TextField
          name="customerName"
          label={t('dashboard.invitationNew.customerName')}
          defaultValue={invitation.customerName}
          error={errors.fields.customerName}
          autoFocus
        />
        <TextField name="customerPhone" label={t('dashboard.invitationNew.customerPhone')} />
        <small className="muted">{t('dashboard.invitations.changeCustomer.hint')}</small>
        <div className="dash-dialog-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {t('dashboard.common.cancel')}
          </button>
          <button type="submit" className="btn btn--gold btn--sm" disabled={change.isPending}>
            {t('dashboard.invitations.changeCustomer.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
