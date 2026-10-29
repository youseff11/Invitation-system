import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** النص اللي هيتنسخ. */
  text: string
  className?: string
  title?: string
  children: ReactNode
}

/** زرار نسخ — بيتحوّل لـ«✓ اتنسخ» لحظة، ولو الحافظة مش متاحة بيعرض النص للنسخ اليدوي. */
export function CopyButton({ text, className, title, children }: Props) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  function copied() {
    setDone(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(false), 1600)
  }

  function copy() {
    const fallback = () => window.prompt(t('guests.copyPrompt'), text)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(copied, fallback)
    } else {
      fallback()
    }
  }

  return (
    <button className={className} type="button" title={title} onClick={copy}>
      {done ? t('guests.copied') : children}
    </button>
  )
}
