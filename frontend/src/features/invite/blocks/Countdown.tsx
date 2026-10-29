import { useEffect, useState, type CSSProperties } from 'react'

import { useInvite } from '../context'
import { fluid, text } from '../style'
import type { BlockData } from '../types'
import { Frame } from './Frame'

interface CountdownProps {
  heading?: string
  eyebrow?: string
  label_days?: string
  label_hours?: string
  label_minutes?: string
  label_seconds?: string
  show_seconds?: boolean
  finished_text?: string
  variant?: string
  countdown_dir?: string
  number_size?: number
  iso?: string
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

/** العدّاد بيتحسب كل ثانية — نفس ‎initCountdowns‎: تاريخ مش صالح = ‎00‎ ثابتة. */
export function Countdown({ block }: { block: BlockData }) {
  const { maxWidth } = useInvite()
  const p = block.props as CountdownProps
  const target = p.iso ? new Date(p.iso).getTime() : NaN
  const valid = !Number.isNaN(target)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!valid) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [valid])

  const diff = valid ? target - now : 1
  const done = valid && diff <= 0
  const s = Math.floor(Math.max(diff, 0) / 1000)
  const parts = valid
    ? {
        days: Math.floor(s / 86400),
        hours: Math.floor((s % 86400) / 3600),
        minutes: Math.floor((s % 3600) / 60),
        seconds: s % 60,
      }
    : { days: 0, hours: 0, minutes: 0, seconds: 0 }
  const dir = p.countdown_dir === 'rtl' || p.countdown_dir === 'ltr' ? p.countdown_dir : undefined

  return (
    <Frame block={block}>
      {p.eyebrow && (
        <p className="lb-eyebrow" data-ts="eyebrow">
          {p.eyebrow}
        </p>
      )}
      {p.heading && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div
        data-move="countdown"
        className={`lb-countdown lb-countdown--${text(p.variant)}${done ? ' is-done' : ''}`}
        style={{ '--num-size': fluid(p.number_size, { ref: maxWidth }) } as CSSProperties}
        data-countdown={p.iso || ''}
        data-finished={p.finished_text || ''}
        data-no-seconds={p.show_seconds ? undefined : '1'}
        data-cd-dir={dir}
      >
        {done ? (
          p.finished_text || ''
        ) : (
          <>
            <div className="lb-cd-unit">
              <strong data-cd="days">{pad(parts.days)}</strong>
              <span data-ts="label_days">{p.label_days}</span>
            </div>
            <div className="lb-cd-unit">
              <strong data-cd="hours">{pad(parts.hours)}</strong>
              <span data-ts="label_hours">{p.label_hours}</span>
            </div>
            <div className="lb-cd-unit">
              <strong data-cd="minutes">{pad(parts.minutes)}</strong>
              <span data-ts="label_minutes">{p.label_minutes}</span>
            </div>
            {p.show_seconds && (
              <div className="lb-cd-unit">
                <strong data-cd="seconds">{pad(parts.seconds)}</strong>
                <span data-ts="label_seconds">{p.label_seconds}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Frame>
  )
}
