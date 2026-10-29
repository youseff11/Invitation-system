import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { appPath } from '@/lib/appPath'

import { useOverview } from '../api'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState, Table } from '../ui/table'

/** نظرة عامة: أرقام + أحدث الدعوات + أحدث تأكيدات الحضور (‎templates/dashboard/index.html‎). */
export function HomePage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const { data, isPending, isError } = useOverview()
  usePageTitle(t('dashboard.home.pageTitle'))

  const stats = data?.stats
  const cards: [number | undefined, string][] = [
    [stats?.invitations, 'invitations'],
    [stats?.published, 'published'],
    [stats?.ordersNew, 'ordersNew'],
    [stats?.customers, 'customers'],
    [stats?.templates, 'templates'],
    [stats?.guests, 'guests'],
    [stats?.attending, 'attending'],
    [stats?.views, 'views'],
  ]

  return (
    <>
      <PageHead title={t('dashboard.home.title')}>
        <Link className="btn btn--gold" to="/dashboard/invitations/new">
          {t('dashboard.common.newInvitation')}
        </Link>
      </PageHead>

      <QueryState loading={isPending} error={isError} />
      {data && (
        <>
          <div className="stats">
            {cards.map(([value, key]) => (
              <div className="stat" key={key}>
                <b>{value}</b>
                <span>{t(`dashboard.home.stats.${key}`)}</span>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: 19 }}>{t('dashboard.home.recentInvitations')}</h2>
          <Table
            style={{ marginBottom: 26 }}
            head={[
              t('dashboard.home.cols.invitation'),
              t('dashboard.home.cols.customer'),
              t('dashboard.home.cols.template'),
              t('dashboard.home.cols.status'),
              null,
            ]}
            empty={t('dashboard.home.noInvitations')}
            isEmpty={data.recentInvitations.length === 0}
          >
            {data.recentInvitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.title}</td>
                <td>{invitation.customerName}</td>
                <td>{invitation.templateName}</td>
                <td>
                  <Pill kind={invitation.status}>{labels.status(invitation.status)}</Pill>
                </td>
                <td>
                  <Link className="btn btn--ghost btn--sm" to={appPath(invitation.editorUrl)}>
                    {t('dashboard.common.editor')}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>

          <h2 style={{ fontSize: 19 }}>{t('dashboard.home.recentRsvps')}</h2>
          <Table
            head={[
              t('dashboard.home.cols.name'),
              t('dashboard.home.cols.invitation'),
              t('dashboard.home.cols.status'),
              t('dashboard.home.cols.companions'),
              t('dashboard.home.cols.date'),
            ]}
            empty={t('dashboard.home.noRsvps')}
            isEmpty={data.recentRsvps.length === 0}
          >
            {data.recentRsvps.map((rsvp) => (
              <tr key={rsvp.id}>
                <td>{rsvp.name}</td>
                <td>{rsvp.invitationTitle}</td>
                <td>
                  <Pill kind={rsvp.status}>{labels.status(rsvp.status)}</Pill>
                </td>
                <td>{rsvp.companions}</td>
                <td>{rsvp.createdLabel}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  )
}
