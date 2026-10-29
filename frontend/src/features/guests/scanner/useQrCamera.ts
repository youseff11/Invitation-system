import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * كاميرا قراءة QR.
 *
 * بنستخدم ‎BarcodeDetector‎ لو المتصفح بيدعمه. سفاري (وكل متصفحات الآيفون
 * لأنها كلها WebKit) مافيهوش — فبنقرا الكود بنفسنا بـjsQR: بنرسم فريم الفيديو
 * على canvas ونفك الكود من البكسلات. المكتبة بتتحمّل بس على الأجهزة اللي
 * محتاجاها (import ديناميكي) وبتبدأ تتحمّل أول ما الصفحة تفتح عشان تكون
 * جاهزة أول ما يدوسوا «تشغيل الكاميرا».
 */

interface DetectedCode {
  rawValue?: string
}
interface QrDetector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>
}
interface DetectorConstructor {
  new (options?: { formats?: string[] }): QrDetector
}

type JsQR = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null

let jsqrPromise: Promise<JsQR> | null = null
function loadJsQR(): Promise<JsQR> {
  jsqrPromise ??= import('jsqr')
    .then((module) => module.default as JsQR)
    .catch((error) => {
      jsqrPromise = null
      throw error
    })
  return jsqrPromise
}

function detectorClass(): DetectorConstructor | null {
  const ctor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

function makeDetector(): QrDetector | null {
  const Ctor = detectorClass()
  if (!Ctor) return null
  try {
    return new Ctor({ formats: ['qr_code'] })
  } catch {
    return null // موجود بس مش بيدعم QR
  }
}

/** أطول ضلع للفريم اللي بنفكّه بـjsQR — كفاية جداً لكود قدام الكاميرا، وخفيف على الموبايل. */
const DECODE_MAX_SIDE = 640
const TICK_MS = 300

export type SupportKey = 'noCamera' | 'ready' | 'jsqrFailed' | 'denied' | 'notFound' | 'busy'

export function cameraSupported() {
  return !!navigator.mediaDevices?.getUserMedia
}

export function useQrCamera(videoRef: RefObject<HTMLVideoElement | null>, onCode: (raw: string) => void) {
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<QrDetector | null>(null)
  const jsqrRef = useRef<JsQR | null>(null)
  const timerRef = useRef<number | null>(null)
  const scanningRef = useRef(false)
  const canvasRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null)
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  })

  const hasCamera = cameraSupported()
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [support, setSupport] = useState<SupportKey>(hasCamera ? 'ready' : 'noCamera')

  const ensureJsQR = useCallback(() => {
    return loadJsQR().then(
      (fn) => {
        jsqrRef.current = fn
      },
      () => {
        setSupport('jsqrFailed')
      },
    )
  }, [])

  // التحميل المبكر للمكتبة على الأجهزة اللي مفيهاش BarcodeDetector
  useEffect(() => {
    if (hasCamera && !detectorClass()) void ensureJsQR()
  }, [hasCamera, ensureJsQR])

  const decodeFrame = useCallback((video: HTMLVideoElement): DetectedCode[] => {
    const jsQR = jsqrRef.current
    if (!jsQR) return []
    const w = video.videoWidth
    const h = video.videoHeight
    const scale = Math.min(1, DECODE_MAX_SIDE / Math.max(w, h))
    const cw = Math.round(w * scale)
    const ch = Math.round(h * scale)
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return []
      canvasRef.current = { canvas, ctx }
    }
    const { canvas, ctx } = canvasRef.current
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    ctx.drawImage(video, 0, 0, cw, ch)
    const code = jsQR(ctx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'dontInvert' })
    return code ? [{ rawValue: code.data }] : []
  }, [])

  const tick = useCallback(() => {
    const video = videoRef.current
    if (!streamRef.current || !video || !video.videoWidth || scanningRef.current) return
    let found: Promise<DetectedCode[]>
    const detector = detectorRef.current
    if (detector) {
      scanningRef.current = true
      found = detector.detect(video)
    } else if (jsqrRef.current) {
      try {
        found = Promise.resolve(decodeFrame(video))
      } catch {
        return
      }
    } else {
      return // jsQR لسه بيتحمّل
    }
    found
      .then((codes) => {
        scanningRef.current = false
        const raw = String(codes[0]?.rawValue ?? '').trim()
        if (raw) onCodeRef.current(raw)
      })
      .catch(() => {
        scanningRef.current = false
      })
  }, [decodeFrame, videoRef])

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    detectorRef.current = null
    scanningRef.current = false
    const video = videoRef.current
    if (video) video.srcObject = null
  }, [videoRef])

  const stop = useCallback(() => {
    release()
    setActive(false)
    setStarting(false)
  }, [release])

  const start = useCallback(() => {
    if (!cameraSupported()) return
    setStarting(true)
    // لازم getUserMedia تتنده جوّه الضغطة نفسها، قبل أي انتظار —
    // سفاري بيرفض الكاميرا لو الطلب جه بعد await لتحميل حاجة.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        release()
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          // سفاري بيحتاج الخاصيتين دول كـproperties مش بس attributes
          video.muted = true
          video.playsInline = true
          video.setAttribute('playsinline', '')
          video.srcObject = stream
          void video.play()?.catch(() => {})
        }
        setActive(true)
        setStarting(false)
        setSupport('ready')
        detectorRef.current = makeDetector()
        if (!detectorRef.current) void ensureJsQR()
        timerRef.current = window.setInterval(tick, TICK_MS)
      })
      .catch((error: unknown) => {
        setStarting(false)
        const name = (error as { name?: string } | null)?.name
        setSupport(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'notFound'
              : 'busy',
        )
      })
  }, [ensureJsQR, release, tick, videoRef])

  // الكاميرا لازم تتقفل لما الصفحة تتفكّ
  useEffect(() => release, [release])

  return { active, starting, support, canStart: hasCamera, start, stop }
}
