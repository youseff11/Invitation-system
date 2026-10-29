import { useEffect, useState, type RefObject } from 'react'

import { prefersReducedMotion } from './motion'

/**
 * مؤثرات الهيرو بتقف وهي مش على الشاشة (النجوم بتعيد رسم طبقتها كل فريم حتى
 * وهي مخفية) وكمان لو التاب اتخفى.
 */
export function useHeroIdle(hero: RefObject<HTMLElement | null>): boolean {
  const [offscreen, setOffscreen] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)

  useEffect(() => {
    const el = hero.current
    if (!el || prefersReducedMotion() || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => setOffscreen(!entries[0].isIntersecting), {
      threshold: 0,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hero])

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return offscreen || hidden
}

