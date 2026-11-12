/**
 * تحميل فيديو كامل في الذاكرة قبل ما يتعرض، والتشغيل من نسخة الذاكرة.
 *
 * الاستضافة (PythonAnywhere) كل طلب فيها بياخد ~0.6ث قبل أول بايت، والسرعة
 * لكل اتصال ~5-7 ميجابت — قريبة من معدل فيديو أوريجنال ‎1080p‎ (الافتتاحية
 * ~3.5 ميجابت). التشغيل من الشبكة كان بيقطّع: الفيديوهين بيتحمّلوا مع بعض
 * فالسرعة بتتقسم، والآيفون بيطلب حتت صغيرة ورا بعض وكل حتة بانتظارها.
 * من الذاكرة مفيش شبكة وقت التشغيل خالص.
 *
 * - **ورا بعض مش مع بعض**: الافتتاحية الأول (بتتسجّل الأول لأنها قبل
 *   الأقسام في الشجرة)، وبعدها الفيديو اللي بيكمّلها — كل واحد ياخد السرعة كلها.
 * - **من ‎/media/‎ مش ‎/media-video/‎**: التحميل الكامل مش محتاج Range، و‎/media/‎
 *   الاستضافة بتخدمه بنفسها؛ ‎/media-video/‎ بيحجز worker من Django طول التحميل.
 *   لو ‎/media/‎ رجّع خطأ بنرجع للرابط الأصلي.
 */
let queue: Promise<unknown> = Promise.resolve()

/** أقصى حجم بنحمّله كله في الذاكرة. ١٦ مش ٨: الفيديو بقى أوريجنال (من غير
 *  نسخة موبايل)، و‎1080p‎ لعشر ثواني ممكن يعدّي ٨ — والأكبر من الحد بيشتغل
 *  من الشبكة عادي (ويقطّع على الاستضافة البطيئة). */
export const PREFETCH_MAX_BYTES = 16 * 1024 * 1024

/** ‎/media-video/x.mp4‎ → ‎/media/x.mp4‎ (نفس الملف، من غير Django). */
export function directMediaUrl(url: string): string {
  return url.replace(/^((?:https?:)?\/\/[^/]+)?\/media-video\//, (_m, host: string | undefined) => `${host ?? ''}/media/`)
}

async function download(url: string, signal: AbortSignal, maxBytes: number): Promise<Blob | 'big' | null> {
  const res = await fetch(url, { signal, credentials: 'same-origin' })
  if (!res.ok) return null
  if (Number(res.headers.get('Content-Length') || 0) > maxBytes) {
    // أكبر من الحد: مانكمّلش تنزيله — الفيديو هيشتغل من الشبكة عادي
    res.body?.cancel().catch(() => {})
    return 'big'
  }
  const blob = await res.blob()
  return blob.size && blob.size <= maxBytes ? blob : 'big'
}

/**
 * يرجّع رابط ‎blob:‎ للفيديو كله، أو ‎''‎ (أكبر من الحد، اتلغى، أو فشل) —
 * والفيديو ساعتها بيفضل على رابطه العادي. المستدعي مسؤول عن ‎revokeObjectURL‎.
 */
export function prefetchVideo(url: string, signal: AbortSignal, maxBytes: number): Promise<string> {
  const run = async (): Promise<string> => {
    if (!url || signal.aborted || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return ''
    const direct = directMediaUrl(url)
    let got: Blob | 'big' | null = null
    try {
      got = await download(direct, signal, maxBytes)
    } catch {
      if (signal.aborted) return ''
    }
    if (got === null && direct !== url && !signal.aborted) {
      try {
        got = await download(url, signal, maxBytes)
      } catch {
        return ''
      }
    }
    if (!got || got === 'big' || signal.aborted) return ''
    const typed = got.type.startsWith('video/') ? got : new Blob([got], { type: 'video/mp4' })
    return URL.createObjectURL(typed)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => '')
  return result.catch(() => '')
}
