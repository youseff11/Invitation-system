import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { checkinScan, useCheckinInfo } from '../api'
import { guestsRoute } from '../links'
import { ScannerPanel } from '../scanner/ScannerPanel'
import { useScanFlow } from '../scanner/useScanFlow'
import '../styles/base.css'
import '../styles/dash.css'

/** ‎/dashboard/invitations/:id/checkin‎ — شاشة الاستقبال: مسح رمز الضيف أو إدخاله يدوي. */
export function CheckinPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const { data, error, isPending } = useCheckinInfo(id)
  const flow = useScanFlow({ scan: (token) => checkinScan(id, token) })

  useDocumentTitle(data ? t('guests.checkin.docTitle', { title: data.invitation.title }) : '')

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

  return (
    <div className="gw">
      <div className="dash-head">
        <h1>{t('guests.checkin.title')}</h1>
        <Link className="btn btn--ghost" to={guestsRoute(data.invitation.id)}>
          ↩ {t('guests.checkin.back')}
        </Link>
      </div>
      <ScannerPanel flow={flow} arrived={data.arrived} total={data.total} variant="checkin" />
    </div>
  )
}
