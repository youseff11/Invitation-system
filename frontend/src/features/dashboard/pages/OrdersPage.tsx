import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { useOrders } from '../api'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState, Table } from '../ui/table'

/** الطلبات: فلتر الحالة + جدول بأسعار وقت الشراء (‎templates/dashboard/orders.html‎). */
export function OrdersPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const { data: site } = useSite()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const { data, isPending, isError } = useOrders(status)
  usePageTitle(t('dashboard.orders.pageTitle'))

  return (
    <>
      <PageHead title={t('dashboard.orders.title')} />
      <form
        className="toolbar"
        key={status}
        onSubmit={(event) => {
          event.preventDefault()
          const value = String(new FormData(event.currentTarget).get('status') ?? '')
          setParams(value ? { status: value } : {})
        }}
      >
        <select name="status" defaultValue={status}>
          <option value="">{t('dashboard.orders.allStatuses')}</option>
          {data?.statusChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {labels.status(choice.value)}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost btn--sm" type="submit">
          {t('dashboard.orders.filter')}
        </button>
      </form>

      <QueryState loading={isPending} error={isError} />
      {data && (
        <Table
          head={[
            '#',
            t('dashboard.orders.cols.customer'),
            t('dashboard.orders.cols.phone'),
            t('dashboard.orders.cols.plan'),
            t('dashboard.orders.cols.total'),
            t('dashboard.orders.cols.template'),
            t('dashboard.orders.cols.event'),
            t('dashboard.orders.cols.status'),
            null,
          ]}
          empty={t('dashboard.orders.none')}
          isEmpty={data.results.length === 0}
        >
          {data.results.map((order) => (
            <tr key={order.id}>
              <td>{order.id}</td>
              <td>{order.customerName}</td>
              <td>{order.customerPhone}</td>
              <td>
                {order.planName}
                {order.addons.map((addon, index) => (
                  <span key={index}>
                    <br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      + {addon.name} ({addon.price})
                    </span>
                  </span>
                ))}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <strong>{order.total}</strong> <small className="muted">{site?.currency}</small>
              </td>
              <td>{order.templateName || '—'}</td>
              <td>
                {order.eventType} · {order.eventDate || '—'}
              </td>
              <td>
                <Pill kind={order.status}>{labels.status(order.status)}</Pill>
              </td>
              <td>
                <a className="btn btn--ghost btn--sm" href={order.adminUrl}>
                  {t('dashboard.orders.open')}
                </a>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
