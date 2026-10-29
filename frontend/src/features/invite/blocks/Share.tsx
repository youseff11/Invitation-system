import { useEffect, useRef, useState } from 'react'

import { useInvite } from '../context'
import { Icon } from '../svg'
import type { BlockData } from '../types'
import { Frame } from './Frame'

interface ShareProps {
  heading?: string
  show_copy?: boolean
  copy_label?: string
  show_whatsapp?: boolean
  whatsapp_label?: string
  show_native?: boolean
  show_calendar?: boolean
  calendar_label?: string
  whatsappUrl?: string
  calendarUrl?: string
  whatsappAllowed?: boolean
  calendarAllowed?: boolean
}

/** نسخ الرابط والمشاركة الأصلية — نفس ‎initShare‎. */
export function Share({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = block.props as ShareProps
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = () => {
    const url = location.href
    const write = navigator.clipboard
      ? navigator.clipboard.writeText(url)
      : Promise.reject(new Error('no clipboard'))
    write
      .then(() => {
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        window.prompt(t('share.prompt'), url)
      })
  }

  const share = () => {
    if (navigator.share) {
      navigator.share({ title: document.title, url: location.href }).catch(() => {})
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(location.href)
    }
  }

  return (
    <Frame block={block}>
      {p.heading && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div className="lb-btn-row" data-move="share">
        {p.show_copy && (
          <button type="button" className="lb-btn lb-btn--outline" data-copy-link onClick={copy}>
            <Icon name="star" size={18} />
            <span data-ts="copy_label">{copied ? t('share.copied') : p.copy_label}</span>
          </button>
        )}
        {p.show_whatsapp && p.whatsappAllowed && (
          <a className="lb-btn lb-btn--outline" href={p.whatsappUrl || '#'} target="_blank" rel="noopener">
            <Icon name="phone" size={18} />
            <span data-ts="whatsapp_label">{p.whatsapp_label}</span>
          </a>
        )}
        {p.show_calendar && p.calendarAllowed && (
          <a className="lb-btn lb-btn--outline" href={p.calendarUrl || '#'} target="_blank" rel="noopener">
            <Icon name="calendar" size={18} />
            <span data-ts="calendar_label">{p.calendar_label}</span>
          </a>
        )}
        {p.show_native && (
          <button type="button" className="lb-btn lb-btn--ghost" data-native-share onClick={share}>
            <Icon name="gift" size={18} />
            <span>{t('share.native')}</span>
          </button>
        )}
      </div>
    </Frame>
  )
}
