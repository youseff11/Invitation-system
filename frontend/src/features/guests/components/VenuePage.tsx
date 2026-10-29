import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { guestKeys, useVenueState, venueMark, venueScan } from '../api'
import { absoluteUrl, venuePath } from '../links'
import { ScannerPanel } from '../scanner/ScannerPanel'
import { useScanFlow } from '../scanner/useScanFlow'
import type { VenueMarkResponse, VenueRow, VenueState } from '../types'
import { useNoIndex } from '../useNoIndex'
import { CopyButton } from './CopyButton'
import { InvalidLink } from './PageStatus'
import '../styles/base.css'
import '../styles/venue.css'

type Filter = 'all' | 'in' | 'out'

const norm = (text: string) => text.trim().toLowerCase()

function matches(row: VenueRow, filter: Filter, query: string) {
  if (filter === 'in' && !row.checkedIn) return false
  if (filter === 'out' && row.checkedIn) return false
  if (!query) return true
  return [row.name, row.code, row.group].some((value) => norm(value).includes(query))
}

/**
 * ‎/i/:slug/venue/:token‎ — بوابة القاعة: شاشة الباب.
 *
 * مفيش حساب ولا كلمة سر: اللي معاه الرابط بيمسح أكواد الضيوف ويشوف مين دخل ومين
 * لسه. صلاحيته على ضيوف الدعوة دي بس. الباب ممكن يكون عليه أكتر من تليفون
 * فاتحين نفس الرابط، فالسيرفر هو مصدر الحقيقة الوحيد: الكشف بيتحدّث كل ٨
 * ثواني ومن رد كل تسجيل، مش بيتعدّل محلياً.
 */
export function VenuePage() {
  const { slug = '', token = '' } = useParams()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, error, isPending, refetch } = useVenueState(slug, token)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useNoIndex()
  useDocumentTitle(data ? t('guests.venue.docTitle', { title: data.invitation.title }) : '')

  const flow = useScanFlow({
    scan: (code) => venueScan(slug, token, code),
    // المسحة الناجحة بتغيّر الكشف عند كل التليفونات — نجيبه من جديد
    onScanned: () => void refetch(),
  })

  if (isPending) return <div className="gw venue-page" aria-busy="true" />
  if (error || !data) {
    return (
      <div className="gw venue-page">
        <main className="venue">
          <InvalidLink error={error} messageKey="guests.venue.invalid" />
        </main>
      </div>
    )
  }

  const { invitation, rows, stats } = data
  const shown = rows.filter((row) => matches(row, filter, norm(query)))

  function mark(row: VenueRow, action: 'in' | 'undo') {
    if (busy) return
    setBusy(true)
    venueMark(slug, token, row.id, action).then(
      (d: VenueMarkResponse) => {
        setBusy(false)
        qc.setQueryData<VenueState>(guestKeys.venue(slug, token), (old) =>
          old ? { ...old, rows: d.rows, stats: d.stats } : old,
        )
        if (d.error) {
          flow.flash(
            d.guest.allowed <= 0
              ? t('guests.venue.noPass')
              : t('guests.venue.exhausted', { used: d.guest.used, allowed: d.guest.allowed }),
            'bad',
          )
        } else if (action === 'undo') {
          flow.flash(t('guests.venue.undone', { name: d.guest.name }), 'warn')
        } else {
          flow.flash(
            t('guests.venue.marked', { name: d.guest.name, used: d.guest.used, allowed: d.guest.allowed }),
            'ok',
          )
        }
      },
      () => {
        setBusy(false)
        flow.flash(t('guests.scan.offline'), 'bad')
      },
    )
  }

  const names = invitation.nameOne ? (
    <>
      {invitation.nameOne}
      {invitation.nameTwo && (
        <>
          {' '}
          <span>{t('guests.venue.and')}</span> {invitation.nameTwo}
        </>
      )}
    </>
  ) : (
    invitation.title
  )

  const filters: [Filter, string][] = [
    ['all', t('guests.venue.filterAll')],
    ['in', t('guests.venue.filterIn')],
    ['out', t('guests.venue.filterOut')],
  ]

  return (
    <div className="gw venue-page">
      <main className="venue">
        <header className="venue-head">
          <p className="venue-kicker">{t('guests.venue.kicker')}</p>
          <h1>{names}</h1>
          <p className="venue-sub">
            {invitation.venue}
            {invitation.venue && invitation.eventAtLabel && ' · '}
            {invitation.eventAtLabel}
          </p>
        </header>

        <section className="venue-stats" aria-label={t('guests.venue.summary')}>
          <article className="venue-stat venue-stat--ok">
            <span className="venue-stat-label">{t('guests.venue.arrived')}</span>
            <strong>{stats.arrived}</strong>
          </article>
          <article className="venue-stat">
            <span className="venue-stat-label">{t('guests.venue.waiting')}</span>
            <strong>{stats.waiting}</strong>
          </article>
          <article className="venue-stat">
            <span className="venue-stat-label">{t('guests.venue.guests')}</span>
            <strong>{stats.guests}</strong>
          </article>
          <article className="venue-stat">
            <span className="venue-stat-label">{t('guests.venue.entries')}</span>
            <strong>
              <span>{stats.used}</span> <small>{t('guests.venue.outOf', { total: stats.allowed })}</small>
            </strong>
          </article>
        </section>

        <ScannerPanel flow={flow} arrived={stats.used} total={stats.allowed} variant="venue" />

        <section className="venue-list" aria-labelledby="venue-list-title">
          <div className="venue-list-head">
            <h2 id="venue-list-title">{t('guests.venue.listTitle')}</h2>
            <div className="venue-filters" role="tablist">
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'venue-tab is-on' : 'venue-tab'}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="venue-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('guests.venue.search')}
              autoComplete="off"
            />
          </div>

          <div className="venue-rows">
            {shown.map((row) => (
              <article className={row.checkedIn ? 'venue-row is-in' : 'venue-row'} key={row.id}>
                <div className="venue-row-main">
                  <strong>{row.name}</strong>
                  <span className="venue-row-meta">
                    <code>{row.code}</code>
                    {row.group && ` · ${row.group}`}
                  </span>
                </div>
                <div className="venue-row-count">
                  {row.used} / {row.allowed}
                </div>
                <div className="venue-row-state">
                  {row.checkedIn ? (
                    <span className="venue-badge venue-badge--in">{t('guests.venue.in', { time: row.at })}</span>
                  ) : (
                    <span className="venue-badge">{t('guests.venue.notYet')}</span>
                  )}
                </div>
                <div className="venue-row-actions">
                  {/* التصريح اللي خلص مالوش زر دخول — الزرار اللي بيرفض الضغط أحسن من زرار بيرجّع خطأ كل مرة */}
                  {row.left > 0 && (
                    <button className="btn btn--gold btn--sm" type="button" onClick={() => mark(row, 'in')}>
                      {t('guests.venue.enter')}
                    </button>
                  )}
                  {row.used > 0 && (
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => mark(row, 'undo')}>
                      {t('guests.venue.undo')}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {rows.length === 0 && <p className="venue-empty">{t('guests.venue.empty')}</p>}
          </div>
          {rows.length > 0 && shown.length === 0 && <p className="venue-empty">{t('guests.venue.noMatch')}</p>}
        </section>

        <footer className="venue-foot">
          <p>{t('guests.venue.foot')}</p>
          <CopyButton className="btn btn--ghost btn--sm" text={absoluteUrl(venuePath(slug, token))}>
            {t('guests.venue.copyLink')}
          </CopyButton>
        </footer>
      </main>
    </div>
  )
}
