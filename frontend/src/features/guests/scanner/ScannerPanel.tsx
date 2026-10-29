import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import './scanner.css'
import { useQrCamera } from './useQrCamera'
import type { useScanFlow } from './useScanFlow'

interface Props {
  flow: ReturnType<typeof useScanFlow>
  /** العدّاد من السيرفر قبل أول مسحة؛ بعدها (في شاشة الاستقبال) بيتحدّث من رد المسح. */
  arrived: number
  total: number
  /** شاشة الاستقبال في اللوحة، أو الماسح اللي في بوابة القاعة. */
  variant: 'checkin' | 'venue'
}

/**
 * الماسح بكل أجزائه: الكاميرا، الإدخال اليدوي، العدّاد، النتيجة، والسجل.
 * مشترك بين شاشة الاستقبال وبوابة القاعة — المنطق واحد، اللي بيفرق هو مين
 * مسموح له يوصل للنقطة (والـAPI بيتحقق من ده).
 */
export function ScannerPanel({ flow, arrived, total, variant }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useQrCamera(videoRef, (raw) => flow.submit(raw))
  const [manual, setManual] = useState('')
  const venue = variant === 'venue'

  function submitManual(event: FormEvent) {
    event.preventDefault()
    const value = manual.trim()
    if (!value) return
    flow.submit(value, true)
    setManual('')
  }

  // بوابة القاعة: الكشف الحيّ (اللي بيتحدّث من كل التليفونات) هو المصدر دايماً
  const shownArrived = venue ? arrived : (flow.counts?.arrived ?? arrived)
  const shownTotal = venue ? total : (flow.counts?.total ?? total)
  const { result } = flow

  return (
    <section className={venue ? 'checkin venue-scanner' : 'checkin'}>
      <div className="checkin-main">
        <div className="checkin-stage">
          <video ref={videoRef} playsInline muted />
          <div className="checkin-frame" aria-hidden="true" />
          {!camera.active && <p className="checkin-idle">{t(venue ? 'guests.scan.idleVenue' : 'guests.scan.idle')}</p>}
        </div>

        <div className="toolbar">
          <button
            className="btn btn--gold"
            type="button"
            onClick={camera.start}
            disabled={!camera.canStart || camera.active || camera.starting}
          >
            {t('guests.scan.start')}
          </button>
          <button className="btn btn--ghost" type="button" onClick={camera.stop}>
            {t('guests.scan.stop')}
          </button>
        </div>

        <p className={venue ? 'muted venue-support' : 'muted checkin-support'}>
          {t(`guests.scan.support.${camera.support}`)}
        </p>

        <form className={venue ? 'toolbar venue-manual' : 'toolbar checkin-manual'} onSubmit={submitManual}>
          <input
            type="text"
            name="token"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={t(venue ? 'guests.scan.manualVenue' : 'guests.scan.manual')}
            autoComplete="off"
            autoCapitalize={venue ? 'characters' : undefined}
            spellCheck={venue ? false : undefined}
          />
          <button className="btn btn--ghost btn--sm" type="submit">
            {t('guests.scan.register')}
          </button>
        </form>
      </div>

      <aside className="checkin-side">
        <div className={venue ? 'stat venue-scan-stat' : 'stat'}>
          <b>{shownArrived}</b>
          <span>{t(venue ? 'guests.scan.entriesOf' : 'guests.scan.arrivedOf', { total: shownTotal })}</span>
        </div>
        <div className={result ? `checkin-result is-${result.kind}` : 'checkin-result'} aria-live="polite">
          {result ? (
            <>
              <strong>{result.title}</strong>
              {result.lines.filter(Boolean).map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </>
          ) : (
            <p className="muted">{t('guests.scan.resultHint')}</p>
          )}
        </div>
        <h3 className={venue ? 'venue-log-title' : 'checkin-log-title'}>{t('guests.scan.recent')}</h3>
        <ul className="checkin-log">
          {flow.log.map((entry, index) => (
            <li key={`${index}-${entry}`}>{entry}</li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
