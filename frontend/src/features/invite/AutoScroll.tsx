import { useEffect, useRef } from 'react'

import { useInvite } from './context'
import type { ScrollConfig } from './types'

declare global {
  interface Window {
    __lbScroll?: { start: () => void; stop: (finished?: boolean) => void }
  }
}

const SPEED_PPS: Record<string, number> = { slow: 18, normal: 34, fast: 60 } // بكسل في الثانية

/**
 * الدعوة بتنزل لوحدها بالراحة زي العرض (نفس ‎initAutoScroll‎):
 * ١) الضيف أهم من العرض: أي لمسة أو تمرير أو ضغطة بتوقّفه نهائياً.
 * ٢) بيتحرّك بالبكسل الجزئي (بنجمّع الكسور ونمرّر لما توصل بكسل كامل).
 * ٣) prefers-reduced-motion بيلغيه خالص.
 */
export function AutoScroll({ config }: { config: ScrollConfig }) {
  const { t } = useInvite()
  // الترجمة بتتغيّر مع اللغة، بس المشغّل مايتعاد تشغيله بسبب كده
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const btn = useRef<HTMLButtonElement>(null)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const enabled = config.enabled && !reduced

  useEffect(() => {
    const button = btn.current
    if (!enabled || !button || window.__lbScroll) return
    const speed = SPEED_PPS[config.speed ?? ''] || SPEED_PPS.normal
    const delay = Math.max(0, Number(config.delay) || 0) * 1000
    const loop = Boolean(config.loop)
    let running = false
    let raf = 0
    let last = 0
    let carry = 0
    let startTimer: number | undefined
    let stoppedByUser = false

    const atBottom = () => {
      const el = document.scrollingElement || document.documentElement
      return el.scrollTop + window.innerHeight >= el.scrollHeight - 2
    }

    const stop = (finished?: boolean) => {
      running = false
      if (raf) {
        window.cancelAnimationFrame(raf)
        raf = 0
      }
      if (startTimer) {
        clearTimeout(startTimer)
        startTimer = undefined
      }
      button.classList.add('is-paused')
      button.setAttribute('aria-label', tRef.current('scroll.play'))
      // خلص لآخر الصفحة؟ الزر مالوش لازمة تاني
      if (finished && !loop) button.hidden = true
    }

    const frame = (now: number) => {
      if (!running) return
      if (!last) last = now
      const dt = Math.min(now - last, 100) // تبويب راجع من الخلفية
      last = now
      carry += (speed * dt) / 1000
      const step = Math.floor(carry)
      if (step >= 1) {
        carry -= step
        // auto مش smooth: التنعيم مع حركة مستمرة بيتخانق مع نفسه
        window.scrollBy({ top: step, behavior: 'auto' })
      }
      if (atBottom()) {
        if (loop) {
          window.scrollTo({ top: 0, behavior: 'smooth' })
          carry = 0
        } else {
          stop(true)
          return
        }
      }
      raf = window.requestAnimationFrame(frame)
    }

    const start = () => {
      if (running || stoppedByUser) return
      running = true
      last = 0
      carry = 0
      button.hidden = false
      button.classList.remove('is-paused')
      button.setAttribute('aria-label', tRef.current('scroll.pause'))
      raf = window.requestAnimationFrame(frame)
    }

    // الزر نفسه مستثنى — دي ضغطة على تحكّم بتاعنا مش محاولة قراءة
    const userStop = (e: Event) => {
      if (e.target && button.contains(e.target as Node)) return
      stoppedByUser = true
      stop(false)
    }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    events.forEach((ev) => window.addEventListener(ev, userStop, { passive: true }))

    const onClick = () => {
      stoppedByUser = false
      if (running) {
        stoppedByUser = true
        stop(false)
      } else start()
    }
    button.addEventListener('click', onClick)

    const schedule = () => {
      if (startTimer) clearTimeout(startTimer)
      stoppedByUser = false
      startTimer = window.setTimeout(start, delay)
    }

    // الافتتاحية بتقفل التمرير على الصفحة، فمالوش معنى نبدأ قبلها
    window.__lbScroll = { start: schedule, stop }
    if (document.querySelector('.lb-intro:not(.is-open)')) {
      document.addEventListener('lb:intro-open', schedule, { once: true })
    } else {
      schedule()
    }

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, userStop))
      button.removeEventListener('click', onClick)
      document.removeEventListener('lb:intro-open', schedule)
      if (startTimer) clearTimeout(startTimer)
      if (raf) window.cancelAnimationFrame(raf)
      delete window.__lbScroll
    }
  }, [enabled, config.speed, config.delay, config.loop])

  if (!enabled) return null
  return (
    <button ref={btn} type="button" className="lb-autoscroll" hidden>
      <svg className="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" />
      </svg>
      <svg className="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.2v13.6L19 12 8 5.2Z" />
      </svg>
    </button>
  )
}
