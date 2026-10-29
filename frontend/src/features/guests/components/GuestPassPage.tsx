import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useGuestPass } from '../api'
import { personalPath } from '../links'
import { passLabel } from '../scanner/useScanFlow'
import { useNoIndex } from '../useNoIndex'
import { InvalidLink } from './PageStatus'
import '../styles/base.css'
import '../styles/pass.css'

/**
 * ‎/i/:slug/g/:token/pass‎ — تصريح الدخول: الضيف بيشوف الـQR ويحمّله من هنا.
 * مفتوحة بالرمز زي الرابط الشخصي: اللي معاه الرابط معاه التصريح. قابلة للطباعة.
 */
export function GuestPassPage() {
  const { slug = '', token = '' } = useParams()
  const { t } = useTranslation()
  const { data, error, isPending } = useGuestPass(slug, token)

  useNoIndex()
  useDocumentTitle(data ? t('guests.pass.docTitle', { name: data.guest.name }) : '')

  if (isPending) return <div className="pass-page" aria-busy="true" />
  if (error || !data) {
    return (
      <div className="pass-page">
        <InvalidLink error={error} messageKey="guests.pass.invalid" />
      </div>
    )
  }

  const { invitation, guest, qrSvg, pngUrl, siteName } = data
  const title = invitation.nameOne
    ? invitation.nameTwo
      ? `${invitation.nameOne} & ${invitation.nameTwo}`
      : invitation.nameOne
    : invitation.title

  return (
    <div className="pass-page">
      <main className="pass">
        <div className="pass-top">
          <p className="ev">{t('guests.pass.event')}</p>
          <h1>{title}</h1>
          <p className="who">{guest.name}</p>
        </div>
        <div className="tear" />

        <div className="pass-body">
          {/* الـSVG بيتولّد على السيرفر من مكتبة QR (مش من مدخلات مستخدم) */}
          <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="code">{guest.passCode}</p>
          <span className={`pass-pill pass-pill--${guest.passStatus}`}>{passLabel(t, guest.passStatus)}</span>

          <div className="meta">
            <div>
              <b>{guest.entriesAllowed}</b>
              <span>{t('guests.pass.allowed')}</span>
            </div>
            <div>
              <b>{guest.entriesUsed}</b>
              <span>{t('guests.pass.used')}</span>
            </div>
            <div>
              <b>{guest.entriesLeft}</b>
              <span>{t('guests.pass.left')}</span>
            </div>
          </div>

          <a className="pass-btn" href={pngUrl} download>
            {t('guests.pass.download')}
          </a>
          <Link className="pass-btn pass-btn--ghost" to={personalPath(invitation.slug, guest.token)}>
            {t('guests.pass.openInvitation')}
          </Link>

          <p className="hint">
            {guest.passStatus === 'used'
              ? t('guests.pass.hintUsed')
              : guest.passStatus === 'none'
                ? t('guests.pass.hintNone')
                : t('guests.pass.hintActive', {
                    n: guest.entriesLeft,
                    people: guest.entriesLeft === 1 ? t('guests.pass.onePerson') : t('guests.pass.people'),
                  })}
          </p>
        </div>
      </main>

      <p className="brand-note">
        {t('guests.pass.madeWith')} <Link to="/">{siteName}</Link>
      </p>
    </div>
  )
}
