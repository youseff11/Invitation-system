/**
 * رابط خريطة جوجل ← رابط تضمين (‎output=embed‎) ينفع يتعرض جوّه ‎<iframe>‎. منقول من ‎mapEmbedUrl‎ في ‎editor.js‎ القديم.
 * بيقبل: كود تضمين كامل (‎<iframe src=…>‎)، رابط تضمين جاهز، رابط مكان/بحث/اتجاهات، إحداثيات ‎29.99, 31.13‎، أو اسم مكان.
 * الروابط المختصرة (‎goo.gl‎، ‎maps.app.goo.gl‎) مابتتحلّش من غير شبكة — بترجع فاضي والواجهة بتشرح للمستخدم.
 */

/** ‎<iframe>‎ خريطة جوجل؟ (نفس تعبير القديم) */
export const GOOGLE_MAP = /google\.com\/maps|maps\.googleapis\.com/i

const LAT_LNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

function latLng(text: string): string {
  const m = LAT_LNG.exec(text)
  if (!m) return ''
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? `${lat},${lng}` : ''
}

function fromQuery(query: string, zoom: string): string {
  if (!query) return ''
  return `https://www.google.com/maps?q=${encodeURIComponent(query).replace(/%2C/g, ',')}${zoom ? `&z=${zoom}` : ''}&output=embed`
}

export function mapEmbedUrl(value: unknown): string {
  let raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/<iframe/i.test(raw)) {
    const src = /<iframe[^>]*\ssrc\s*=\s*(['"])([\s\S]*?)\1/i.exec(raw)
    if (!src) return ''
    raw = src[2].trim().replace(/&amp;/g, '&')
  }
  if (!/^https?:\/\//i.test(raw)) {
    const typed = latLng(raw)
    if (typed) return fromQuery(typed, '16')
    return raw.length <= 300 ? fromQuery(raw, '') : ''
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'goo.gl' || host === 'maps.app.goo.gl' || host === 'g.co') return ''
  if (!host.includes('google.')) return raw
  if (url.pathname.includes('/maps/embed') || /(?:^|&)output=embed(?:&|$)/.test(url.search.replace(/^\?/, ''))) return raw

  const first = (...keys: string[]) => {
    for (const key of keys) {
      const v = url.searchParams.get(key)
      if (v && v.trim()) return v.trim()
    }
    return ''
  }
  const at = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(url.pathname)
  let zoom = ''
  const z = first('z', 'zoom')
  if (/^\d{1,2}(?:\.\d+)?$/.test(z)) zoom = z
  else if (at?.[3]) zoom = String(Math.round(parseFloat(at[3])))

  let pair = ''
  const precise = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(raw)
  if (precise) pair = latLng(`${precise[1]},${precise[2]}`)
  if (!pair) pair = latLng(first('ll', 'sll', 'center'))
  if (!pair && at) pair = latLng(`${at[1]},${at[2]}`)
  if (!pair) {
    for (const key of ['q', 'query', 'daddr', 'destination']) {
      pair = latLng(first(key))
      if (pair) break
    }
  }
  if (!pair) {
    for (const segment of url.pathname.split('/')) {
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        /* زي ما هو */
      }
      pair = latLng(decoded)
      if (pair) break
    }
  }
  if (pair) return fromQuery(pair, zoom || '16')

  let text = first('q', 'query', 'daddr', 'destination')
  if (!text) {
    const place = /\/maps\/(?:place|search|dir)\/([^/@?]+)/.exec(url.pathname)
    if (place) {
      try {
        text = decodeURIComponent(place[1])
      } catch {
        text = place[1]
      }
      text = text.replace(/\+/g, ' ').trim()
    }
  }
  return text ? fromQuery(text.slice(0, 300), zoom) : ''
}
