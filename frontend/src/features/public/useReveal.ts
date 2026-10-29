import { useLayoutEffect } from 'react'

import { prefersReducedMotion } from './motion'

/**
 * الظهور التدريجي بالسكرول لعناصر ‎[data-reveal]‎ جوّه ‎#main‎ (بما فيها اللي
 * بتتضاف بعد وصول البيانات). نفس سلوك ‎site.js‎: الأقسام تظهر لما تدخل الشاشة،
 * والكروت ورا بعض (‎data-reveal-stagger‎)، ومع «تقليل الحركة» تظهر كلها فوراً.
 *
 * كلاس ‎js‎ على ‎<html>‎ هو اللي بيخلّي الـCSS يخبّي العناصر دي — فبنضيفه
 * قبل أول رسم (layout effect) عشان مايبقاش فيه ومضة «ظاهر ثم مخفي».
 */
export function useReveal() {
  useLayoutEffect(() => {
    document.documentElement.classList.add('js')
    const root = document.getElementById('main') ?? document.body

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      const showAll = () =>
        root.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'))
      showAll()
      const mutations = new MutationObserver(showAll)
      mutations.observe(root, { childList: true, subtree: true })
      return () => mutations.disconnect()
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          if (el.hasAttribute('data-reveal-stagger') && el.parentElement) {
            // ترتيب العنصر جوّه أبوه بيحدد التأخير — الكروت بتظهر ورا بعض
            const index = Array.prototype.indexOf.call(el.parentElement.children, el)
            el.style.setProperty('--reveal-delay', `${Math.min(index, 8) * 70}ms`)
          }
          el.classList.add('is-in')
          io.unobserve(el)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    const seen = new WeakSet<Element>()
    const scan = () =>
      root.querySelectorAll('[data-reveal]').forEach((el) => {
        if (seen.has(el)) return
        seen.add(el)
        io.observe(el)
      })
    scan()
    const mutations = new MutationObserver(scan)
    mutations.observe(root, { childList: true, subtree: true })
    return () => {
      io.disconnect()
      mutations.disconnect()
    }
  }, [])
}
