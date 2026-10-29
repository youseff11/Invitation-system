/**
 * التمرير الناعم للروابط الداخلية (‎#rsvp‎ وأخواتها) و‎[data-scroll]‎ — نسخة من
 * ‎initScrollLinks‎. بيتربط مرة واحدة على المستند.
 */
export function bindScrollLinks(): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null
    const link = target && target.closest ? target.closest('a[href^="#"], [data-scroll]') : null
    if (!link) return
    const sel = link.getAttribute('href') || link.getAttribute('data-scroll')
    if (!sel || sel === '#' || sel.length < 2) return
    let dest: Element | null = null
    try {
      dest = document.querySelector(sel)
    } catch {
      return // محدِّد مش صالح
    }
    if (!dest) return
    e.preventDefault()
    dest.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
