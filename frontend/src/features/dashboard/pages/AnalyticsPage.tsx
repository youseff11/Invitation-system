import { useTranslation } from 'react-i18next'

import { useAnalytics } from '../api'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState, Table } from '../ui/table'

/** أكثر الدعوات مشاهدة: شريط لكل دعوة بنسبة مشاهداتها لأعلى واحدة. */
function ViewsChart({ rows }: { rows: { label: string; views: number; rsvps: number }[] }) {
  const { t } = useTranslation()
  if (rows.length === 0) return <div data-chart>{t('dashboard.analytics.noChart')}</div>
  const max = Math.max(...rows.map((row) => row.views || 0)) || 1
  return (
    <div data-chart>
      {rows.map((row, index) => (
        <div
          key={index}
          style={{
            display: 'grid',
            gridTemplateColumns: '150px 1fr auto',
            gap: 10,
            alignItems: 'center',
            marginBottom: 9,
            fontSize: 13,
          }}
        >
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }}
          >
            {row.label}
          </span>
          <div style={{ height: 9, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 99,
                width: `${Math.round(((row.views || 0) / max) * 100)}%`,
              }}
            />
          </div>
          <b style={{ color: 'var(--accent)' }}>
            {row.views || 0} / {row.rsvps || 0}
          </b>
        </div>
      ))}
    </div>
  )
}

/** الإحصائيات (‎templates/dashboard/analytics.html‎). */
export function AnalyticsPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const { data, isPending, isError } = useAnalytics()
  usePageTitle(t('dashboard.analytics.pageTitle'))

  return (
    <>
      <PageHead title={t('dashboard.analytics.title')} />
      <QueryState loading={isPending} error={isError} />
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <b>{data.totals.views}</b>
              <span>{t('dashboard.analytics.totalViews')}</span>
            </div>
            <div className="stat">
              <b>{data.totals.attending}</b>
              <span>{t('dashboard.analytics.attending')}</span>
            </div>
            <div className="stat">
              <b>{data.totals.declined}</b>
              <span>{t('dashboard.analytics.declined')}</span>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('dashboard.analytics.topTitle')}</h3>
            <ViewsChart rows={data.chart} />
          </div>

          <Table
            style={{ marginTop: 20 }}
            head={[
              t('dashboard.analytics.cols.invitation'),
              t('dashboard.analytics.cols.status'),
              t('dashboard.analytics.cols.views'),
              t('dashboard.analytics.cols.rsvps'),
              t('dashboard.analytics.cols.guests'),
            ]}
            empty={t('dashboard.analytics.none')}
            isEmpty={data.invitations.length === 0}
          >
            {data.invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.title}</td>
                <td>
                  <Pill kind={invitation.status}>{labels.status(invitation.status)}</Pill>
                </td>
                <td>{invitation.views}</td>
                <td>{invitation.rsvps}</td>
                <td>{invitation.guests}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  )
}
