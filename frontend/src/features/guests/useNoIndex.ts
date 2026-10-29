import { useEffect } from 'react'

/**
 * صفحات الرموز (القاعة، العميل، التصريح) خاصة: مش للفهرسة. الـAPI بيبعت
 * ‎X-Robots-Tag‎ بس زاحف بيقرا الـshell بيشوف الـmeta، فبنحدّثها هنا
 * (وبنرجّع القديمة لما الصفحة تتفكّ).
 */
export function useNoIndex() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const created = !meta
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'robots'
      document.head.appendChild(meta)
    }
    const previous = meta.content
    meta.content = 'noindex, nofollow'
    return () => {
      if (created) meta.remove()
      else meta.content = previous
    }
  }, [])
}
