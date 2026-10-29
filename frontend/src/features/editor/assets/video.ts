/**
 * أول فريم من فيديو — بيتاخد في المتصفح (‎canvas‎):
 *  - عند الرفع: لو السيرفر معندوش ffmpeg، الفريم ده هو المصغّرة وغلاف الافتتاحية.
 *  - في مكتبة الافتتاحيات: لو العنصر ملوش غلاف محفوظ، الفريم بيتخزّن في ‎settings.intro_poster‎.
 * مطابق لـ‎makeClientVideoThumbnail‎ و‎captureLibraryFrame‎ في ‎editor.js‎ القديم.
 */

/** الغلاف بيتعرض ملء الشاشة قبل الفيديو: بمقاس الفيديو الأصلي من غير تصغير (PNG من غير فقد). */
const UPLOAD_EDGE = Infinity
/** PNG لفريم 4K ممكن يكبر أوي؛ فوق الحد ده بنرجع لـJPEG بأعلى جودة (السيرفر بيقبل لحد ٢٤ ميجا). */
const PNG_MAX_BYTES = 20 * 1024 * 1024
/** فريم مكتبة الافتتاحيات بيتحفظ جوّه المستند نفسه (data URL) فالحجم بيتحسب مرتين. */
const LIBRARY_EDGE = 1440
const TIMEOUT_MS = 8000

function draw(video: HTMLVideoElement, maxEdge: number): HTMLCanvasElement | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const ratio = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * ratio))
  canvas.height = Math.max(1, Math.round(video.videoHeight * ratio))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** data URL للفريم الحالي، أو ‎''‎ لو الفيديو لسه ما حمّلش أو المتصفح منع ‎canvas‎ (فيديو من نطاق تاني). */
export function frameDataUrl(video: HTMLVideoElement): string {
  try {
    return draw(video, LIBRARY_EDGE)?.toDataURL('image/jpeg', 0.9) ?? ''
  } catch {
    return ''
  }
}

/** بيستنى أول فريم (حد أقصى ‎timeout‎) ويرجّعه كـdata URL. */
export function waitForFrame(video: HTMLVideoElement, timeout = 1800): Promise<string> {
  if (video.videoWidth && video.videoHeight) return Promise.resolve(frameDataUrl(video))
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadeddata', finish)
      video.removeEventListener('canplay', finish)
      resolve(frameDataUrl(video))
    }
    const timer = window.setTimeout(finish, timeout)
    video.addEventListener('loadeddata', finish, { once: true })
    video.addEventListener('canplay', finish, { once: true })
    try {
      video.load()
    } catch {
      finish()
    }
  })
}

/** أول فريم من ملف فيديو بمقاسه الأصلي (PNG، أو JPEG بجودة ١٠٠٪ لو الـPNG كبير أوي)، أو ‎null‎ (مش فيديو / فشل / عدّى ٨ ثواني). */
export function makeClientVideoThumbnail(file: File): Promise<Blob | null> {
  if (!/^video\//i.test(file.type || '')) return Promise.resolve(null)
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)
    let settled = false
    const finish = (blob: Blob | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        /* مفيش مشكلة */
      }
      resolve(blob)
    }
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS)
    const capture = () => {
      try {
        const canvas = draw(video, UPLOAD_EDGE)
        if (!canvas) return
        canvas.toBlob((png) => {
          if (png && png.size <= PNG_MAX_BYTES) finish(png)
          else canvas.toBlob((jpeg) => finish(jpeg ?? png), 'image/jpeg', 1)
        }, 'image/png')
      } catch {
        finish(null)
      }
    }
    video.muted = true
    video.defaultMuted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = objectUrl
    video.addEventListener('loadedmetadata', () => {
      try {
        video.currentTime = 0.01
      } catch {
        /* بعض الصيغ مابتسمحش بالـseek قبل التحميل */
      }
    })
    video.addEventListener('loadeddata', capture, { once: true })
    video.addEventListener('canplay', capture, { once: true })
    video.addEventListener('error', () => finish(null), { once: true })
    video.load()
  })
}
