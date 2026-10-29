import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { prefersReducedMotion } from './motion'

/*
 * مؤثرات الصفحة الرئيسية: نجوم بتقع + شهاب + وهج ذهبي (نفس site.js القديم).
 * كله بيقف لو المستخدم مفعّل «تقليل الحركة» (مابنولّدش النجوم أصلاً)، وبيقف
 * كمان لما التاب يبقى مخفي عشان ما ياكلش بطارية على الموبايل.
 */

interface Star {
  left: number
  size: number
  duration: number
  delay: number
  drift: number
  peak: number
  spark: boolean
}

function makeStars(count: number): Star[] {
  return Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    size: Math.random() * 3 + 1.6, // 1.6 → 4.6px
    duration: Math.random() * 9 + 9, // 9 → 18s
    delay: -Math.random() * 18, // تبدأ متفرقة مش سوا
    drift: Math.round((Math.random() - 0.5) * 120), // ميل يمين/شمال
    peak: Math.random() * 0.45 + 0.4,
    spark: i % 4 === 0,
  }))
}

interface StarFieldProps {
  count: number
  /** ‎page‎: مسافة السقوط = ارتفاع الشاشة؛ وإلا ارتفاع الحاوية نفسها */
  scale?: 'page'
  className: string
  idle?: boolean
}

export function StarField({ count, scale, className, idle }: StarFieldProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [stars] = useState(() => {
    if (prefersReducedMotion()) return []
    // على الشاشات الصغيرة نص العدد — أداء أحسن وشكل أهدى
    return makeStars(window.innerWidth < 700 ? Math.round(count * 0.55) : count)
  })

  // مسافة السقوط: النجمة تخفت وهي بتخرج من تحت مش تختفي فجأة عند حافة القص
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || stars.length === 0) return
    const size = () => {
      const height = scale === 'page' ? window.innerHeight : el.offsetHeight || window.innerHeight
      el.style.setProperty('--fall', `${height + 70}px`)
    }
    size()
    let timer: number | undefined
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(size, 200)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [scale, stars.length])

  return (
    <div ref={ref} className={className + (idle ? ' fx-idle' : '')}>
      {stars.map((star, i) => (
        <span
          key={i}
          className={'fx-star' + (star.spark ? ' fx-star--spark' : '')}
          style={
            {
              insetInlineStart: `${star.left.toFixed(2)}%`,
              '--s': `${star.size.toFixed(1)}px`,
              '--dur': `${star.duration.toFixed(1)}s`,
              '--delay': `${star.delay.toFixed(1)}s`,
              '--drift': `${star.drift}px`,
              '--peak': star.peak.toFixed(2),
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

interface Shot {
  id: number
  top: number
  end: number
}

/** شهاب بيعدّي كل ٦-١٤ ثانية من مكان عشوائي فوق الصورة. */
export function ShootingStars({ idle }: { idle: boolean }) {
  const [shots, setShots] = useState<Shot[]>([])
  const idleRef = useRef(idle)
  useEffect(() => {
    idleRef.current = idle
  }, [idle])

  useEffect(() => {
    if (prefersReducedMotion()) return
    let timer: number | undefined
    let counter = 0
    const removals = new Set<number>()

    const shoot = () => {
      if (document.hidden || idleRef.current) return
      const id = ++counter
      setShots((all) => [...all, { id, top: Math.random() * 42 + 4, end: Math.random() * 34 - 6 }])
      const removal = window.setTimeout(() => {
        removals.delete(removal)
        setShots((all) => all.filter((shot) => shot.id !== id))
      }, 1700)
      removals.add(removal)
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        shoot()
        schedule()
      }, Math.random() * 8000 + 6000)
    }
    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer)
      else schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      removals.forEach((removal) => window.clearTimeout(removal))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div className={'hero-shooting' + (idle ? ' fx-idle' : '')} aria-hidden="true">
      {shots.map((shot) => (
        <span
          key={shot.id}
          className="fx-shoot"
          style={{ top: `${shot.top.toFixed(1)}%`, insetInlineEnd: `${shot.end.toFixed(1)}%` }}
        />
      ))}
    </div>
  )
}

/** طبقة ثابتة ورا المحتوى: نجوم بتقع + وهج ذهبي خفيف. زخرفة بحتة. */
export function FxSky() {
  return (
    <div className="fx-sky" aria-hidden="true">
      <span className="fx-glow fx-glow--a" />
      <span className="fx-glow fx-glow--b" />
      <StarField className="fx-stars" count={18} scale="page" />
    </div>
  )
}
