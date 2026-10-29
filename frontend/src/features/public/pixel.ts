/** نفس معرّف البكسل في templates/partials/_meta_pixel.html. */
export const PIXEL_ID = '1510217587797836'

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  loaded: boolean
  version: string
  push: Fbq
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

/** كود ميتا الرسمي (fbevents.js) بنفس خطواته — مرة واحدة بس. */
export function installFbq(): Fbq {
  if (window.fbq) return window.fbq
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args)
    else fbq.queue.push(args)
  }) as Fbq
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = '2.0'
  fbq.queue = []
  window.fbq = fbq
  window._fbq = fbq
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)
  return fbq
}

/** قناة التواصل لرابط واتساب/اتصال/إيميل — فاضي لو الرابط مش تواصل. */
export function contactChannel(href: string): 'whatsapp' | 'phone' | 'email' | '' {
  if (/wa\.me|api\.whatsapp\.com|^whatsapp:/i.test(href)) return 'whatsapp'
  if (/^tel:/i.test(href)) return 'phone'
  if (/^mailto:/i.test(href)) return 'email'
  return ''
}

