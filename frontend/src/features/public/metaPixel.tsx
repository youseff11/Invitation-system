import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { boot } from '@/app/boot'
import { PIXEL_ID, contactChannel, installFbq } from './pixel'

/**
 * Meta Pixel لصفحات الموقع العام: PageView مع كل صفحة (وكل تنقّل جوّه التطبيق)
 * وحدث Contact لما الزائر يدوس على رابط واتساب أو اتصال أو إيميل.
 * مش بيشتغل في وضع التطوير عشان تجارب المطوّر والاختبارات ماتلخبطش الإحصائيات.
 */
export function MetaPixel() {
  const { pathname } = useLocation()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (boot.debug) return
    const fbq = installFbq()
    if (lastPath.current === null) fbq('init', PIXEL_ID)
    // أول صفحة + كل تنقّل بعدها (الصفحة نفسها مابتتحمّلش من جديد في الـSPA)
    if (lastPath.current !== pathname) fbq('track', 'PageView')
    lastPath.current = pathname
  }, [pathname])

  useEffect(() => {
    if (boot.debug) return
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      const fbq = window.fbq
      if (!anchor || typeof fbq !== 'function') return
      const channel = contactChannel(anchor.getAttribute('href') ?? '')
      if (channel) fbq('track', 'Contact', { content_name: channel })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return null
}
