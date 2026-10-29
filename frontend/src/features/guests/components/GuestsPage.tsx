import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useGuestsPage } from '../api'
import { downloadFile } from '../download'
import {
  absoluteUrl,
  checkinRoute,
  clientPath,
  editorPath,
  exportUrl,
  qrSheetRoute,
  venuePath,
} from '../links'
import type { GuestRow } from '../types'
import { CopyButton } from './CopyButton'
import { GuestForm } from './GuestForm'
import { GuestsTable } from './GuestsTable'
import { ImportCard } from './ImportCard'
import { RsvpTable } from './RsvpTable'
import type { Flash } from './flash'
import '../styles/base.css'
import '../styles/dash.css'

/** ‎/dashboard/invitations/:id/guests‎ — كشف الضيوف والإحصائيات والاستيراد والإضافة. */
export function GuestsPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const { data, error, isPending } = useGuestsPage(id)
  const [editing, setEditing] = useState<GuestRow | null>(null)
  const [flashes, setFlashes] = useState<Flash[]>([])
  const formRef = useRef<HTMLDivElement>(null)

  useDocumentTitle(data ? t('guests.docTitle', { title: data.invitation.title }) : '')

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

  const { invitation, stats, passEnabled, guests, rsvps } = data
  const notify = (kind: Flash['kind'], text: string) => setFlashes([{ kind, text }])

  function edit(guest: GuestRow) {
    setEditing(guest)
    setFlashes([])
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  function exportXlsx() {
    downloadFile(exportUrl(invitation.id), `${invitation.slug}-guests.xlsx`).catch((exportError: unknown) =>
      notify(
        'error',
        exportError instanceof ApiError ? exportError.message || t('errors.generic') : t('errors.network'),
      ),
    )
  }

  const venue = absoluteUrl(venuePath(invitation.slug, invitation.venueToken))
  const client = absoluteUrl(clientPath(invitation.slug, invitation.clientToken))

  const statCards: [number, string][] = [
    [stats.guests, t('guests.stats.invited')],
    [stats.entriesAllowed, t('guests.stats.allowed')],
    [stats.entriesUsed, t('guests.stats.used')],
    [stats.attending, t('guests.stats.attending')],
    [stats.attendingPeople, t('guests.stats.attendingPeople')],
    [stats.views, t('guests.stats.views')],
  ]

  return (
    <div className="gw">
      {flashes.map((flash, index) => (
        <div key={index} className={`flash flash--${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>
          {flash.text}
        </div>
      ))}

      <div className="dash-head">
        <h1>{t('guests.title', { title: invitation.title })}</h1>
        <div className="toolbar toolbar--flush">
          <Link className="btn btn--gold" to={checkinRoute(invitation.id)}>
            📷 {t('guests.actions.checkin')}
          </Link>
          <Link
            className="btn btn--ghost"
            to={venuePath(invitation.slug, invitation.venueToken)}
            target="_blank"
            rel="noopener"
          >
            🏛 {t('guests.actions.venue')}
          </Link>
          <CopyButton className="btn btn--ghost" title={t('guests.actions.copyVenueHint')} text={venue}>
            {t('guests.actions.copyVenue')}
          </CopyButton>
          <Link
            className="btn btn--ghost"
            to={clientPath(invitation.slug, invitation.clientToken)}
            target="_blank"
            rel="noopener"
          >
            👤 {t('guests.actions.client')}
          </Link>
          <CopyButton className="btn btn--ghost" title={t('guests.actions.copyClientHint')} text={client}>
            {t('guests.actions.copyClient')}
          </CopyButton>
          {passEnabled && (
            <Link className="btn btn--ghost" to={qrSheetRoute(invitation.id)} target="_blank" rel="noopener">
              🖨 {t('guests.actions.qrSheet')}
            </Link>
          )}
          <button className="btn btn--ghost" type="button" onClick={exportXlsx}>
            ⤓ {t('guests.actions.export')}
          </button>
          <Link className="btn btn--ghost" to={editorPath(invitation.id)}>
            ↩ {t('guests.actions.editor')}
          </Link>
        </div>
      </div>

      <div className="stats">
        {statCards.map(([value, label]) => (
          <div className="stat" key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <ImportCard invitationId={id} onResult={setFlashes} />

      <div className="gw-split">
        <div>
          <h2>{t('guests.listTitle')}</h2>
          <GuestsTable
            invitationId={id}
            slug={invitation.slug}
            guests={guests}
            passEnabled={passEnabled}
            editingId={editing?.id ?? null}
            onEdit={edit}
            onNotify={notify}
          />

          <h2>{t('guests.rsvpTitle')}</h2>
          <RsvpTable rsvps={rsvps} />
        </div>

        <div ref={formRef}>
          <GuestForm
            key={editing?.id ?? 'new'}
            invitationId={id}
            editing={editing}
            onDone={(message) => {
              setEditing(null)
              notify('success', message)
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      </div>
    </div>
  )
}
