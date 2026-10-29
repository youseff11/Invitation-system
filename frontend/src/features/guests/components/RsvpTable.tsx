import { useTranslation } from 'react-i18next'

import { rsvpLabel } from '../scanner/useScanFlow'
import type { RsvpRow } from '../types'

/** جدول تأكيدات الحضور (RSVP) — للقراءة بس. */
export function RsvpTable({ rsvps }: { rsvps: RsvpRow[] }) {
  const { t } = useTranslation()
  return (
    <div className="table-wrap table-cards">
      <table>
        <thead>
          <tr>
            <th>{t('guests.rsvp.name')}</th>
            <th>{t('guests.rsvp.status')}</th>
            <th>{t('guests.rsvp.companions')}</th>
            <th>{t('guests.rsvp.message')}</th>
            <th>{t('guests.rsvp.date')}</th>
          </tr>
        </thead>
        <tbody>
          {rsvps.map((rsvp) => (
            <tr key={rsvp.id}>
              <td className="cell--title">{rsvp.name}</td>
              <td data-label={t('guests.rsvp.status')}>
                <span className={`pill pill--${rsvp.status}`}>{rsvpLabel(t, rsvp.status)}</span>
              </td>
              <td data-label={t('guests.rsvp.companions')}>{rsvp.companions}</td>
              <td className="cell--wide cell--message" data-label={t('guests.rsvp.message')}>
                {rsvp.message || '—'}
                {rsvp.answers.map((answer, index) => (
                  <span className="rsvp-answer" key={index}>
                    <b>{answer.q}</b>
                    {answer.a}
                  </span>
                ))}
              </td>
              <td data-label={t('guests.rsvp.date')}>{rsvp.createdAt}</td>
            </tr>
          ))}
          {rsvps.length === 0 && (
            <tr className="is-empty">
              <td colSpan={5} className="empty">
                {t('guests.rsvp.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
