import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useQrSheet } from '../api'
import { guestsRoute } from '../links'
import '../styles/base.css'
import '../styles/dash.css'
import '../styles/qr-sheet.css'

/** ‎/dashboard/invitations/:id/guests/qr-sheet‎ — ورقة طباعة: كارت QR لكل ضيف. */
export function QrSheetPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const { data, error, isPending } = useQrSheet(id)

  useDocumentTitle(data ? t('guests.qr.docTitle', { title: data.invitation.title }) : '')

  if (isPending) return <div className="gw" aria-busy="true" />
  if (error || !data) {
    return (
      <div className="gw">
        <p className="empty">
          {error instanceof ApiError && error.status === 404 ? t('guests.notFound') : t('errors.generic')}
        </p>
      </div>
    )
  }

  const { invitation, rows } = data
  const names = invitation.nameTwo ? `${invitation.nameOne} & ${invitation.nameTwo}` : invitation.nameOne

  return (
    <div className="gw">
      <div className="qrsheet">
        <header className="qrsheet-bar no-print">
          <div>
            <strong>{t('guests.qr.heading', { title: invitation.title })}</strong>
            <span className="muted"> · {t('guests.qr.count', { n: rows.length })}</span>
          </div>
          <div className="toolbar">
            <button className="btn btn--gold btn--sm" type="button" onClick={() => window.print()}>
              🖨 {t('guests.qr.print')}
            </button>
            <Link className="btn btn--ghost btn--sm" to={guestsRoute(invitation.id)}>
              ↩ {t('guests.qr.back')}
            </Link>
          </div>
        </header>

        <p className="qrsheet-hint no-print">{t('guests.qr.hint')}</p>

        <div className="qrsheet-grid">
          {rows.map((row) => (
            <article className="qrcard" key={row.id}>
              <p className="qrcard-event">{names}</p>
              {/* الـSVG بيتولّد على السيرفر من مكتبة QR (مش من مدخلات مستخدم) */}
              <div className="qrcard-code" dangerouslySetInnerHTML={{ __html: row.svg }} />
              <p className="qrcard-name">{row.name}</p>
              {row.groupName && <p className="qrcard-meta">{row.groupName}</p>}
              {row.plusOnesAllowed > 0 && (
                <p className="qrcard-meta">{t('guests.qr.plus', { n: row.plusOnesAllowed })}</p>
              )}
            </article>
          ))}
          {rows.length === 0 && <p className="empty">{t('guests.qr.empty')}</p>}
        </div>
      </div>
    </div>
  )
}
