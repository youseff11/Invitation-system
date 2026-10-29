import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useConfirm } from '@/features/dashboard/ui/ConfirmDialog'
import { useDeleteGuest, useToggleCheckin } from '../api'
import { absoluteUrl, passPath, personalPath, qrPngUrl, whatsappGuestUrl } from '../links'
import { passLabel, rsvpLabel } from '../scanner/useScanFlow'
import type { GuestRow } from '../types'
import { CopyButton } from './CopyButton'

interface Props {
  invitationId: string
  slug: string
  guests: GuestRow[]
  passEnabled: boolean
  editingId: number | null
  onEdit: (guest: GuestRow) => void
  onNotify: (kind: 'success' | 'error', text: string) => void
}

/** كشف الضيوف: الكود، النوع، الدخول، الحالة، الروابط، وإجراءات الصف. */
export function GuestsTable({ invitationId, slug, guests, passEnabled, editingId, onEdit, onNotify }: Props) {
  const { t } = useTranslation()
  const toggle = useToggleCheckin(invitationId)
  const remove = useDeleteGuest(invitationId)
  const confirm = useConfirm()

  function failed(error: unknown) {
    onNotify('error', error instanceof ApiError ? error.message || t('errors.generic') : t('errors.network'))
  }

  async function confirmDelete(guest: GuestRow) {
    const message = t('guests.table.confirmDelete', { name: guest.name })
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    remove.mutate(guest.id, {
      onSuccess: () => onNotify('success', t('guests.flash.deleted')),
      onError: failed,
    })
  }

  return (
    <div className="table-wrap table-cards" style={{ marginBottom: 24 }}>
      <table className="guests-table">
        <thead>
          <tr>
            <th>{t('guests.table.code')}</th>
            <th>{t('guests.table.type')}</th>
            <th>{t('guests.table.guest')}</th>
            <th>{t('guests.table.entries')}</th>
            <th>{t('guests.table.status')}</th>
            <th>{t('guests.table.link')}</th>
            {passEnabled && <th>QR</th>}
            <th>{t('guests.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const link = absoluteUrl(personalPath(slug, guest.token))
            return (
              <tr key={guest.id}>
                <td data-label={t('guests.table.code')}>
                  <code className="pass-code">{guest.passCode}</code>
                </td>
                <td data-label={t('guests.table.type')}>{t(`guests.source.${guest.source}`)}</td>
                <td className="cell--title">
                  {guest.name}
                  {guest.phone && (
                    <>
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {guest.phone}
                      </span>
                    </>
                  )}
                  {guest.rsvpStatus && (
                    <>
                      <br />
                      <span className={`pill pill--${guest.rsvpStatus}`}>{rsvpLabel(t, guest.rsvpStatus)}</span>
                    </>
                  )}
                </td>
                <td className="nums" data-label={t('guests.table.entries')}>
                  <b>
                    {guest.entriesUsed} / {guest.entriesAllowed}
                  </b>
                  <span className="muted">{t('guests.table.left', { n: guest.entriesLeft })}</span>
                </td>
                <td data-label={t('guests.table.status')}>
                  <span className={`pass-state pass-state--${guest.passStatus}`}>{passLabel(t, guest.passStatus)}</span>
                </td>
                <td className="cell--wide" data-label={t('guests.table.link')}>
                  <div className="guest-link">
                    <CopyButton className="btn btn--ghost btn--sm" text={link}>
                      {t('guests.table.copy')}
                    </CopyButton>
                    {guest.phone && (
                      <a
                        className="btn btn--ghost btn--sm"
                        target="_blank"
                        rel="noopener"
                        href={whatsappGuestUrl(guest.name, link)}
                      >
                        {t('guests.table.whatsapp')}
                      </a>
                    )}
                    <Link
                      className="btn btn--ghost btn--sm"
                      target="_blank"
                      rel="noopener"
                      to={personalPath(slug, guest.token)}
                    >
                      {t('guests.table.open')}
                    </Link>
                  </div>
                </td>
                {passEnabled && (
                  <td className="cell--wide" data-label="QR">
                    <div className="guest-link">
                      <a className="btn btn--gold btn--sm" href={qrPngUrl(slug, guest.token)} download>
                        {t('guests.table.download')}
                      </a>
                      <Link
                        className="btn btn--ghost btn--sm"
                        target="_blank"
                        rel="noopener"
                        to={passPath(slug, guest.token)}
                      >
                        {t('guests.table.view')}
                      </Link>
                    </div>
                  </td>
                )}
                <td className="cell--wide" data-label={t('guests.table.actions')}>
                  <div className="guest-link">
                    <button
                      className={guest.checkedIn ? 'btn btn--gold btn--sm' : 'btn btn--ghost btn--sm'}
                      type="button"
                      disabled={toggle.isPending && toggle.variables === guest.id}
                      onClick={() => toggle.mutate(guest.id, { onError: failed })}
                    >
                      {guest.checkedIn ? t('guests.table.checkedIn') : t('guests.table.checkIn')}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      aria-pressed={editingId === guest.id}
                      onClick={() => onEdit(guest)}
                    >
                      {t('guests.table.edit')}
                    </button>
                    <button
                      className="btn btn--ghost btn--danger btn--sm"
                      type="button"
                      disabled={remove.isPending && remove.variables === guest.id}
                      onClick={() => confirmDelete(guest)}
                    >
                      {t('guests.table.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {guests.length === 0 && (
            <tr className="is-empty">
              <td colSpan={passEnabled ? 8 : 7} className="empty">
                {t('guests.table.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
