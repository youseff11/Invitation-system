import { ApiError } from '@/api/client'

function fileName(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return match ? decodeURIComponent(match[1]) : fallback
}

/**
 * ينزّل ملف من الـAPI (xlsx/csv) من غير ما يسيب الصفحة — لو السيرفر رفض
 * (مش مسجّل · الحزمة ناقصة) بيرجع ‎ApiError‎ بدل ما المتصفح يفتح JSON.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } | null = null
    try {
      body = await res.json()
    } catch {
      /* مش JSON */
    }
    throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? res.statusText)
  }
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileName(res, fallbackName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // المتصفح محتاج لحظة يبدأ التنزيل قبل ما نلغي الرابط
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
