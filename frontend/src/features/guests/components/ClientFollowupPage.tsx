import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useClientFollowup } from '../api'
import { passPath, qrPngUrl, qrSvgUrl } from '../links'
import { rsvpLabel } from '../scanner/useScanFlow'
import { useNoIndex } from '../useNoIndex'
import { InvalidLink } from './PageStatus'
import '../styles/base.css'
import '../styles/client.css'

/**
 * تحميل رسائل التهنئة PDF: بنطبع القسم ده لوحده (الـCSS بيخفي الباقي لما ‎body.print-wishes‎ موجود)
 * والمتصفح بيحفظه PDF بالخط العربي الصح من غير مكتبات. عنوان الصفحة هو اسم الملف الافتراضي.
 */
function printWishes(fileTitle: string) {
  const previousTitle = document.title
  const done = () => {
    document.body.classList.remove('print-wishes')
    document.title = previousTitle
    window.removeEventListener('afterprint', done)
  }
  document.title = fileTitle
  document.body.classList.add('print-wishes')
  window.addEventListener('afterprint', done)
  window.print()
}

/**
 * ‎/i/:slug/client/:token‎ — لوحة متابعة خاصة بصاحب الدعوة (للقراءة فقط):
 * الحضور، رموز QR، ورسائل التهنئة. بتعرض الوحدات اللي اتجمّع فيها بيانات فعلاً.
 */
/** أيقونات الأرقام — خطوط دهبي جوّه معيّن بدل الإيموجي (اللي كان شكله بيختلف من موبايل للتاني) */
const STAT_ICONS = {
  all: <path d="m6.5 12.5 3.5 3.5 7.5-8" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M15.5 14.2c2.4-.3 4.4 1.3 5 4.3" />
    </>
  ),
  qr: <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />,
  door: <path d="M10 5H6v14h4M14 8l4 4-4 4m4-4H9" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </>
  ),
}

function StatIcon({ name }: { name: keyof typeof STAT_ICONS }) {
  return (
    <span className="client-followup-stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {STAT_ICONS[name]}
      </svg>
    </span>
  )
}

export function ClientFollowupPage() {
  const { slug = '', token = '' } = useParams()
  const { t } = useTranslation()
  const { data, error, isPending } = useClientFollowup(slug, token)
  const { data: site } = useSite()
  const siteName = site?.displayName ?? ''

  useNoIndex()
  useDocumentTitle(t('guests.client.docTitle'))

  if (isPending) return <div className="gw client-followup-page" aria-busy="true" />
  if (error || !data) {
    return (
      <div className="gw client-followup-page">
        <main className="client-followup">
          <InvalidLink error={error} messageKey="guests.client.invalid" />
        </main>
      </div>
    )
  }

  const { invitation, hasRsvp, hasQr, hasGuestbook, hasAnswers, rsvpRows, messageRows, qrRows, stats } = data
  const names = invitation.nameTwo ? `${invitation.nameOne} ${t('guests.client.and')}${invitation.nameTwo}` : invitation.nameOne
  const answersColumns = hasAnswers ? 6 : 5

  return (
    <div className="gw client-followup-page">
      <main className="client-followup">
        {/* الصفحة دي بيفتحها العميل نفسه، فمفيش كلام موجّه لينا ولا العنوان الداخلي ولا حالة النشر */}
        <header className="client-followup-welcome">
          <Link className="brand brand--stacked client-followup-logo" to="/">
            <span className="sr-only">{siteName}</span>
          </Link>
          <h1>{invitation.nameOne ? t('guests.client.welcomeNamed', { names }) : t('guests.client.welcome')}</h1>
          <p className="client-followup-subtitle">{t('guests.client.subtitle')}</p>
        </header>

        <section className="client-followup-stats" aria-label={t('guests.client.summary')}>
          {hasRsvp && (
            <>
              <article className="client-followup-stat client-followup-stat--hero">
                <StatIcon name="all" />
                <span className="client-followup-stat-label">{t('guests.client.allReplies')}</span>
                <strong>{stats.rsvpTotal}</strong>
              </article>
              <article className="client-followup-stat">
                <StatIcon name="heart" />
                <span className="client-followup-stat-label">{t('guests.client.attending')}</span>
                <strong>{stats.attending}</strong>
                {/* نسبة الحضور من كل الردود */}
                <span className="client-followup-bar" aria-hidden="true">
                  <i style={{ width: `${stats.rsvpTotal ? Math.round((stats.attending / stats.rsvpTotal) * 100) : 0}%` }} />
                </span>
              </article>
              <article className="client-followup-stat">
                <StatIcon name="people" />
                <span className="client-followup-stat-label">{t('guests.client.attendingTotal')}</span>
                <strong>{stats.attendingTotal}</strong>
              </article>
            </>
          )}
          {hasQr && (
            <>
              <article className="client-followup-stat">
                <StatIcon name="qr" />
                <span className="client-followup-stat-label">{t('guests.client.guestsQr')}</span>
                <strong>{stats.guests}</strong>
              </article>
              <article className="client-followup-stat">
                <StatIcon name="door" />
                <span className="client-followup-stat-label">{t('guests.client.checkedIn')}</span>
                <strong>{stats.checkedIn}</strong>
              </article>
            </>
          )}
          {hasGuestbook && (
            <article className="client-followup-stat">
              <StatIcon name="mail" />
              <span className="client-followup-stat-label">{t('guests.client.wishes')}</span>
              <strong>{stats.messages}</strong>
            </article>
          )}
        </section>

        {hasRsvp && (
          <section className="client-followup-section" aria-labelledby="rsvp-title">
            <div className="client-followup-section-head">
              <div>
                <p className="client-followup-kicker">RSVP</p>
                <h2 id="rsvp-title">{t('guests.client.rsvpTitle')}</h2>
              </div>
              <span className="client-followup-count">{t('guests.client.repliesCount', { n: stats.rsvpTotal })}</span>
            </div>
            <div className="client-followup-table-wrap">
              <table className="client-followup-table client-followup-table--rsvp">
                <thead>
                  <tr>
                    <th>{t('guests.rsvp.name')}</th>
                    <th>{t('guests.rsvp.status')}</th>
                    <th>{t('guests.client.companions')}</th>
                    <th>{t('guests.client.comment')}</th>
                    {hasAnswers && <th>{t('guests.client.answers')}</th>}
                    <th>{t('guests.rsvp.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rsvpRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>
                        <span className={`client-followup-pill client-followup-pill--${row.status}`}>
                          {rsvpLabel(t, row.status)}
                        </span>
                      </td>
                      <td data-label={t('guests.client.companions')}>{row.companions}</td>
                      <td className="client-followup-message">{row.message || '—'}</td>
                      {hasAnswers && (
                        <td className="client-followup-answers">
                          {row.answers.length
                            ? row.answers.map((answer, index) => (
                                <span className="client-followup-answer" key={index}>
                                  <b>{answer.q}</b>
                                  {answer.a}
                                </span>
                              ))
                            : '—'}
                        </td>
                      )}
                      <td className="client-followup-date">{row.createdAt}</td>
                    </tr>
                  ))}
                  {rsvpRows.length === 0 && (
                    <tr>
                      <td colSpan={answersColumns} className="client-followup-empty">
                        {t('guests.client.noReplies')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {hasQr && (
          <section className="client-followup-section" aria-labelledby="qr-title">
            <div className="client-followup-section-head">
              <div>
                <p className="client-followup-kicker">QR</p>
                <h2 id="qr-title">{t('guests.client.qrTitle')}</h2>
              </div>
              <span className="client-followup-count">{t('guests.client.guestsCount', { n: stats.guests })}</span>
            </div>
            <div className="client-followup-table-wrap">
              <table className="client-followup-table">
                <thead>
                  <tr>
                    <th>{t('guests.rsvp.name')}</th>
                    <th>{t('guests.client.passCode')}</th>
                    <th>{t('guests.client.entries')}</th>
                    <th>{t('guests.client.symbol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {qrRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>
                        <b className="client-followup-code">{row.passCode}</b>
                      </td>
                      <td>
                        {row.entriesUsed} / {row.entriesAllowed}
                      </td>
                      <td>
                        <img className="client-followup-qr" src={qrSvgUrl(invitation.slug, row.token)} alt={`QR ${row.name}`} />
                      </td>
                      <td className="client-followup-actions">
                        <Link
                          className="btn btn--ghost btn--sm"
                          to={passPath(invitation.slug, row.token)}
                          target="_blank"
                          rel="noopener"
                        >
                          {t('guests.client.view')}
                        </Link>
                        <a className="btn btn--gold btn--sm" href={qrPngUrl(invitation.slug, row.token)}>
                          {t('guests.client.download')}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {qrRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="client-followup-empty">
                        {t('guests.client.noGuests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {hasGuestbook && (
          <section className="client-followup-section client-followup-wishes" aria-labelledby="messages-title">
            <div className="client-followup-section-head">
              <div>
                <p className="client-followup-kicker">GUESTBOOK</p>
                <h2 id="messages-title">{t('guests.client.wishesTitle')}</h2>
                {invitation.nameOne && <p className="client-followup-print-names">{names}</p>}
              </div>
              <span className="client-followup-section-tools">
                <span className="client-followup-count">{t('guests.client.wishesCount', { n: stats.messages })}</span>
                {messageRows.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--gold btn--sm no-print"
                    onClick={() => printWishes(`${t('guests.client.wishesTitle')} — ${names || invitation.slug}`)}
                  >
                    {t('guests.client.wishesPdf')}
                  </button>
                )}
              </span>
            </div>
            <div className="client-followup-messages">
              {messageRows.map((row) => (
                <article className="client-followup-message-card" key={row.id}>
                  <div className="client-followup-message-card-head">
                    <strong>{row.name}</strong>
                    <time>{row.createdAt}</time>
                  </div>
                  <p>{row.message}</p>
                </article>
              ))}
              {messageRows.length === 0 && <p className="client-followup-empty">{t('guests.client.noWishes')}</p>}
            </div>
          </section>
        )}

        {!hasRsvp && !hasQr && !hasGuestbook && (
          <section className="client-followup-empty-state">
            <span>◇</span>
            <h2>{t('guests.client.emptyTitle')}</h2>
            <p>{t('guests.client.emptyText')}</p>
          </section>
        )}
      </main>
    </div>
  )
}
