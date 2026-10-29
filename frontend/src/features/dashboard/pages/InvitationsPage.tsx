import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { appPath } from '@/lib/appPath'

import { useDeleteInvitation, useDuplicateInvitation, useInvitations } from '../api'
import type { InvitationFilters, InvitationRow } from '../types'
import { ChangeCustomerDialog } from '../ui/ChangeCustomerDialog'
import { useConfirm } from '../ui/ConfirmDialog'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { RowMenu, RowMenuButton, RowMenuCopy, RowMenuLink, RowMenuTitle } from '../ui/RowMenu'
import { QueryState, Table } from '../ui/table'
import { useToast } from '../ui/Toast'

/** الدعوات: بحث + فلتر الحالة والقالب + قايمة الروابط والإجراءات (‎templates/dashboard/invitations.html‎). */
export function InvitationsPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const duplicate = useDuplicateInvitation()
  const remove = useDeleteInvitation()
  const [customerOf, setCustomerOf] = useState<InvitationRow | null>(null)
  usePageTitle(t('dashboard.invitations.pageTitle'))

  const filters: InvitationFilters = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    template: params.get('template') ?? '',
  }
  const { data, isPending, isError } = useInvitations(filters)
  const host = window.location.origin

  function applyFilters(form: HTMLFormElement) {
    const values = new FormData(form)
    const next = new URLSearchParams()
    for (const key of ['q', 'status', 'template'] as const) {
      const value = String(values.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }
    setParams(next)
  }

  function onDuplicate(invitation: InvitationRow) {
    duplicate.mutate(invitation.id, {
      onSuccess: (copy) =>
        toast.success(t('dashboard.invitations.duplicated', { title: invitation.title, copy: copy.title })),
      onError: toast.fail,
    })
  }

  async function onDelete(invitation: InvitationRow) {
    let message = t('dashboard.invitations.confirmDelete', { title: invitation.title })
    if (invitation.guests) {
      message += `\n${t('dashboard.invitations.confirmGuests', { guests: invitation.guests, rsvps: invitation.rsvps })}`
    }
    if (invitation.status === 'published') message += `\n${t('dashboard.invitations.confirmPublished')}`
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    remove.mutate(invitation.id, {
      onSuccess: () => toast.success(t('dashboard.invitations.deleted', { title: invitation.title })),
      onError: toast.fail,
    })
  }

  return (
    <>
      <PageHead title={t('dashboard.invitations.title')}>
        <Link className="btn btn--gold" to="/dashboard/invitations/new">
          {t('dashboard.common.newInvitation')}
        </Link>
      </PageHead>

      <form
        className="toolbar"
        key={params.toString()}
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters(event.currentTarget)
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder={t('dashboard.invitations.searchPlaceholder')}
        />
        <select name="status" defaultValue={filters.status}>
          <option value="">{t('dashboard.invitations.allStatuses')}</option>
          {data?.statusChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {labels.status(choice.value)}
            </option>
          ))}
        </select>
        <select name="template" defaultValue={data?.filters.template ?? filters.template}>
          <option value="">{t('dashboard.invitations.allTemplates')}</option>
          {data?.templateChoices.map((choice) => (
            <option key={choice.id} value={String(choice.id)}>
              {choice.name}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost btn--sm" type="submit">
          {t('dashboard.invitations.search')}
        </button>
      </form>

      <QueryState loading={isPending} error={isError} />
      {data && (
        <Table
          cards="lg"
          className="inv-table"
          head={[
            t('dashboard.invitations.cols.invitation'),
            t('dashboard.invitations.cols.customer'),
            t('dashboard.invitations.cols.template'),
            t('dashboard.invitations.cols.status'),
            t('dashboard.invitations.cols.guests'),
            t('dashboard.invitations.cols.rsvps'),
            t('dashboard.invitations.cols.views'),
            t('dashboard.invitations.cols.created'),
            t('dashboard.invitations.cols.actions'),
          ]}
          empty={t('dashboard.invitations.empty')}
          isEmpty={data.results.length === 0}
        >
          {data.results.map((invitation) => (
            <tr key={invitation.id}>
              <td className="cell--title">
                <strong>{invitation.title}</strong>
                <small className="muted">/i/{invitation.slug}/</small>
              </td>
              <td className="cell--text" data-label={t('dashboard.invitations.cols.customer')}>
                {invitation.customerName}
              </td>
              <td className="cell--text" data-label={t('dashboard.invitations.cols.template')}>
                {invitation.templateName}
              </td>
              <td data-label={t('dashboard.invitations.cols.status')}>
                <Pill kind={invitation.status}>{labels.status(invitation.status)}</Pill>
              </td>
              <td data-label={t('dashboard.invitations.cols.guests')}>{invitation.guests}</td>
              <td data-label={t('dashboard.invitations.cols.rsvps')}>{invitation.rsvps}</td>
              <td data-label={t('dashboard.invitations.cols.views')}>{invitation.views}</td>
              <td data-label={t('dashboard.invitations.cols.created')}>
                <time dateTime={invitation.createdAt ?? undefined} title={invitation.createdTitle}>
                  {invitation.createdLabel}
                </time>
              </td>
              <td className="cell--actions">
                <div className="row-actions">
                  <Link className="btn btn--gold btn--sm" to={appPath(invitation.editorUrl)}>
                    {t('dashboard.common.editor')}
                  </Link>
                  <Link className="btn btn--ghost btn--sm" to={`/dashboard/invitations/${invitation.id}/guests`}>
                    {t('dashboard.invitations.guests')}
                  </Link>
                  <RowMenu label={t('dashboard.invitations.links')}>
                    <RowMenuTitle>{t('dashboard.invitations.menu.invitation')}</RowMenuTitle>
                    <RowMenuLink href={invitation.url}>{t('dashboard.invitations.menu.openInvitation')}</RowMenuLink>
                    <RowMenuCopy text={host + invitation.url}>{t('dashboard.invitations.menu.copyInvitation')}</RowMenuCopy>

                    <RowMenuTitle>{t('dashboard.invitations.menu.client')}</RowMenuTitle>
                    <RowMenuLink href={invitation.clientUrl}>{t('dashboard.invitations.menu.openClient')}</RowMenuLink>
                    <RowMenuCopy text={host + invitation.clientUrl}>{t('dashboard.invitations.menu.copyClient')}</RowMenuCopy>

                    <RowMenuTitle>{t('dashboard.invitations.menu.venue')}</RowMenuTitle>
                    <RowMenuLink href={invitation.venueUrl}>{t('dashboard.invitations.menu.openVenue')}</RowMenuLink>
                    <RowMenuCopy text={host + invitation.venueUrl}>{t('dashboard.invitations.menu.copyVenue')}</RowMenuCopy>

                    <RowMenuTitle>{t('dashboard.invitations.menu.itself')}</RowMenuTitle>
                    <RowMenuButton icon="⎘" onClick={() => onDuplicate(invitation)}>
                      {t('dashboard.invitations.menu.duplicate')}
                    </RowMenuButton>
                    <RowMenuButton icon="✎" onClick={() => setCustomerOf(invitation)}>
                      {t('dashboard.invitations.menu.changeCustomer')}
                    </RowMenuButton>
                    <RowMenuButton icon="✕" danger onClick={() => void onDelete(invitation)}>
                      {t('dashboard.invitations.menu.delete')}
                    </RowMenuButton>
                  </RowMenu>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {customerOf && <ChangeCustomerDialog invitation={customerOf} onClose={() => setCustomerOf(null)} />}
    </>
  )
}
