import { useEffect, useRef, useState } from 'react'

import { useInvite } from './context'
import { Raw } from './Raw'
import { parseStyle } from './style'
import type { IntroData } from './types'

declare global {
  interface Window {
    __lbIntro?: { open: () => void; reopen: () => void }
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** كود الافتتاحية: ستايل محصور على ‎.lb-intro‎ + HTML + سكربت (كله متنقّى من السيرفر). */
function codeHtml(intro: IntroData): string {
  const code = intro.code
  if (!code) return ''
  const style = code.css ? `<style>${code.css}</style>` : ''
  const box = code.html
    ? `<div class="lb-intro-extra" data-intro-item="code" style="${esc(intro.itemStyles.code ?? '')}">${code.html}</div>`
    : ''
  const js = code.js ? `<script data-lb-section-script="1">${code.js}</script>` : ''
  return style + box + js
}

/** سكربت الافتتاحية بيذكر الفيديو وبينادي ‎.play()‎ — يعني هو اللي بيقرر إمتى يبدأ. */
function ownsVideo(intro: IntroData): boolean {
  const js = intro.code?.js
  return Boolean(intro.video && js && /video/i.test(js) && /\.play\s*\(/.test(js))
}

/** مهلة الفيديو اللي ماتحرّكش بعد طلب التشغيل قبل ما نسمح بالفتح باللمس. */
const STALL_MS = 12000

/** أقصى حجم لفيديو الافتتاحية اللي بنحمّله كله في الذاكرة قبل الضغطة. */
const PREFETCH_MAX_BYTES = 8 * 1024 * 1024

interface MusicHandle {
  play: () => void
}

/**
 * الشاشة الافتتاحية — نفس ‎initIntro‎: زرار فتح، فيديو (تلقائي أو بضغطة تشغيل،
 * صامت أو بصوت)، عدّاد تلقائي، ولمسة في أي مكان = نفس اللي بيعمله الزرار.
 * الأحداث (‎lb:intro-play‎ و‎lb:intro-open‎) بتتبعت جوّه مكدس الضغطة نفسها
 * عشان سفاري على الآيفون يسمح بتشغيل الصوت.
 *
 * المستمعين native مش React عن قصد: الترتيب (التقاط/فقاعة، ‎stopPropagation‎
 * على الزرار) هو اللي بيحدد مين يفتح الدعوة.
 */
export function Intro({ data }: { data: IntroData }) {
  const { t } = useInvite()
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const playBtn = useRef<HTMLButtonElement>(null)
  const openBtn = useRef<HTMLButtonElement>(null)

  const manual = Boolean(data.video) && (data.playMode === 'button' || data.playMode === 'button_effects')
  // كود الافتتاحية بيشغّل الفيديو بنفسه (مثلاً بعد ٣ دقّات): ماننافسوهوش بتشغيل تلقائي
  const selfPlay = !manual && ownsVideo(data)
  // افتتاحية الفيديو مالهاش تخطّي: الضيف يتفرّج للآخر والدعوة تبدأ بعدها
  const locked = Boolean(data.video)
  const [open, setOpen] = useState(false)
  const [awaiting, setAwaiting] = useState(manual)
  const [blocked, setBlocked] = useState(false)
  const [gone, setGone] = useState(false)
  // الغلاف صورة لوحدها تحت الفيديو، والفيديو مخفي لحد أول فريم بيتشغّل فعلاً
  const [live, setLive] = useState(false)

  useEffect(() => {
    const intro = root.current
    if (!intro) return
    const cleanup: (() => void)[] = []
    let timer: number | undefined
    let isOpen = false
    let isAwaiting = manual
    const vid = video.current
    // الفيديو خلص (أو ماينفعش يتشغّل خالص): ساعتها بس الدعوة تتفتح
    let finished = !locked || !vid
    let forcePlay: (() => void) | null = null
    let stallTimer: number | undefined
    // طلبنا التشغيل والفيديو ماتحرّكش خالص (شبكة واقعة أو جهاز رافض)؟ مانحبسش
    // الضيف: اللمسة بعدها بتفتح الدعوة عادي.
    const armStallGuard = () => {
      if (finished || !vid || stallTimer) return
      stallTimer = window.setTimeout(() => {
        if (vid.currentTime < 0.05) {
          finished = true
          intro.style.cursor = 'pointer'
        }
      }, STALL_MS)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const doOpen = () => {
      // أكتر من طريق للفتح (الزر، لمسة في أي مكان، نهاية الفيديو، العدّاد)
      // وممكن اتنين يوصلوا مع بعض — الحارس بيمنع الإشارة تتبعت مرتين
      if (isOpen) return
      isOpen = true
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      setOpen(true)
      document.body.style.overflow = ''
      ;(window as unknown as { __lbMusic?: MusicHandle | null }).__lbMusic?.play()
      if (vid) {
        try {
          vid.pause()
        } catch {
          /* مش حرج */
        }
      }
      window.setTimeout(() => setGone(true), 700)
      // التمرير التلقائي مستني الإشارة دي — قبلها التمرير مقفول أصلاً
      document.dispatchEvent(new CustomEvent('lb:intro-open'))
    }
    // طرق فتح الضيف (لمسة، زر، عدّاد، غطا الكود): طول ما الفيديو ماخلصش
    // مابتفتحش. لو الفيديو واقف (المتصفح رفض التشغيل التلقائي أو الكود ماشغّلوش)
    // اللمسة بتشغّله، وإلا الضيف هيفضل قدام صورة ثابتة.
    const guestOpen = () => {
      if (finished) {
        doOpen()
        return
      }
      forcePlay?.()
    }
    // ‎window.__lbIntro.open‎ بيفضل يفتح فوراً: المحرر بيستخدمه لتخطّي المعاينة
    window.__lbIntro = { open: doOpen, reopen: () => {} }

    const startAuto = () => {
      if (timer) clearTimeout(timer)
      if (locked) return // الفيديو هو اللي بيفتح لما يخلص، مش العدّاد
      if (data.seconds > 0) timer = window.setTimeout(doOpen, data.seconds * 1000)
    }
    // لو الفيديو مستني ضغطة تشغيل، العدّاد التلقائي يستنى معاه
    if (!manual) startAuto()

    let startManual: (() => void) | null = null
    if (vid) {
      if (data.poster) {
        let shown = false
        const show = () => {
          if (shown) return
          shown = true
          setLive(true)
        }
        const onPlaying = () => {
          // ‎playing‎ بيجي قبل ما أول فريم يترسم؛ نستنى الفريم عشان الغلاف مايتشالش على فراغ
          if ('requestVideoFrameCallback' in vid) vid.requestVideoFrameCallback(show)
          else window.setTimeout(show, 120)
        }
        // سفاري على الآيفون مابينادييش ‎requestVideoFrameCallback‎ لفيديو شفّاف
        // (‎opacity:0‎ لحد ما يظهر) — فالفيديو كان بيشتغل مستخبّي ورا الغلاف والضيف
        // شايف صورة ثابتة. الوقت لما يتحرّك فعلاً = فيه فريمات بتترسم.
        const onTime = () => {
          if (vid.currentTime > 0.05) show()
        }
        vid.addEventListener('playing', onPlaying, { once: true })
        vid.addEventListener('timeupdate', onTime)
        cleanup.push(() => {
          vid.removeEventListener('playing', onPlaying)
          vid.removeEventListener('timeupdate', onTime)
        })
        if (!vid.paused) onPlaying()
      } else {
        // مفيش صورة غلاف: نلتقط أول فريم من الفيديو ونستخدمه كغلاف
        vid.preload = 'auto'
        const capture = () => {
          if (vid.poster || vid.readyState < 2) return
          try {
            const canvas = document.createElement('canvas')
            canvas.width = vid.videoWidth || 1
            canvas.height = vid.videoHeight || 1
            canvas.getContext('2d')?.drawImage(vid, 0, 0, canvas.width, canvas.height)
            vid.poster = canvas.toDataURL('image/jpeg', 0.82)
            vid.style.backgroundImage = `url("${vid.poster}")`
          } catch {
            // روابط الفيديو الخارجية قد تمنع canvas بسبب CORS — لا نعطل التشغيل
          }
        }
        vid.addEventListener('loadeddata', capture, { once: true })
        vid.addEventListener('canplay', capture, { once: true })
        vid.addEventListener(
          'loadedmetadata',
          () => {
            try {
              vid.currentTime = 0.01
            } catch {
              /* مش حرج */
            }
          },
          { once: true },
        )
        if (vid.readyState >= 2) capture()
        try {
          vid.load()
        } catch {
          /* مش حرج */
        }
      }

      /* سفاري على الآيفون بيتجاهل ‎preload="auto"‎: مابيحمّلش غير الفهرس لحد الضغطة،
         وبعدها بيعمل كذا طلب Range ورا بعض (كل واحد ~0.6ث على الاستضافة) — فالضيف
         كان بيستنى ~3 ثواني بعد «اضغط لفتح الدعوة». بنحمّل الملف كله (نسخة
         الموبايل ~0.7 ميجا) من أول ما الصفحة تفتح ونبدّل المصدر لنسخة في الذاكرة،
         فالضغطة بتشغّل على طول. لو الضيف ضغط قبل ما التحميل يخلص، الفيديو بيكمّل
         من الشبكة عادي ومش بنلمسه. */
      const prefetch = new AbortController()
      let blobUrl = ''
      if (typeof fetch === 'function' && typeof URL.createObjectURL === 'function') {
        fetch(data.video, { signal: prefetch.signal, credentials: 'same-origin' })
          .then((res) => {
            const size = Number(res.headers.get('Content-Length') || 0)
            if (!res.ok || size > PREFETCH_MAX_BYTES) {
              prefetch.abort()
              return null
            }
            return res.blob()
          })
          .then((blob) => {
            if (!blob || !blob.size || prefetch.signal.aborted) return
            // اتشغّل خلاص من الشبكة؟ مانقطعوش
            if (isOpen || !vid.paused || vid.currentTime > 0 || (manual && !isAwaiting)) return
            const typed = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' })
            blobUrl = URL.createObjectURL(typed)
            vid.src = blobUrl
          })
          .catch(() => {
            /* التحميل المسبق تحسين بس — الفيديو بيشتغل من الشبكة */
          })
      }
      cleanup.push(() => {
        prefetch.abort()
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      })

      const wantsSound = data.audio === 'sound'
      forcePlay = () => {
        if (!vid.paused || vid.ended) return
        armStallGuard()
        vid.muted = !wantsSound
        const attempt = vid.play()
        if (attempt && attempt.catch) {
          attempt.catch(() => {
            vid.muted = true
            const again = vid.play()
            if (again && again.catch) {
              // الفيديو ماينفعش يتشغّل على الجهاز ده خالص — مانحبسش الضيف
              again.catch(() => {
                finished = true
                doOpen()
              })
            }
          })
        }
      }
      if (manual && playBtn.current) {
        let announced = false
        const announcePlay = () => {
          if (announced) return
          announced = true
          document.dispatchEvent(new CustomEvent('lb:intro-play'))
        }
        startManual = () => {
          if (!isAwaiting) return
          isAwaiting = false
          setAwaiting(false)
          vid.muted = !wantsSound
          if (vid.muted) announcePlay()
          const play = vid.play()
          if (play && play.catch) {
            play.catch(() => {
              // بعض الأجهزة بترفض الصوت برضو — نجرّب صامت
              vid.muted = true
              announcePlay()
              const again = vid.play()
              if (again && again.catch) again.catch(() => setBlocked(true))
            })
          }
          armStallGuard()
          startAuto() // العدّاد يبدأ من دلوقتي
        }
        const onPlay = (e: Event) => {
          e.stopPropagation() // ما نفتحش الدعوة بالغلط
          startManual?.()
        }
        playBtn.current.addEventListener('click', onPlay)
        cleanup.push(() => playBtn.current?.removeEventListener('click', onPlay))
      } else {
        vid.muted = !wantsSound
        if (!selfPlay) {
          const tryPlay = vid.play()
          if (tryPlay && tryPlay.catch) {
            // iOS في وضع توفير الطاقة بيرفض التشغيل — الغلاف بيفضل ظاهر
            tryPlay.catch(() => setBlocked(true))
          }
        }
      }
      const onEnded = () => {
        finished = true
        doOpen()
      }
      // ملف فيديو بايظ أو مش بيتحمّل: ماينفعش نستنى نهايته
      const onError = () => {
        finished = true
        doOpen()
      }
      vid.addEventListener('ended', onEnded)
      vid.addEventListener('error', onError)
      cleanup.push(() => {
        vid.removeEventListener('ended', onEnded)
        vid.removeEventListener('error', onError)
      })
    }

    const btn = openBtn.current
    if (btn) {
      const onBtn = (e: Event) => {
        e.stopPropagation()
        guestOpen()
      }
      btn.addEventListener('click', onBtn)
      cleanup.push(() => btn.removeEventListener('click', onBtn))
    }

    // منطق «غطا الكود» نادر ومش بيتحمّل غير لو الافتتاحية فيها كود
    let cover: { handled: (e: Event) => boolean; dispose: () => void } | null = null
    let disposed = false
    if (data.code?.html) {
      void import('./runtime/intro-code').then((m) => {
        if (disposed) return
        cover = m.bindCodeCover(intro, { open: guestOpen, isOpen: () => isOpen })
      })
    }
    cleanup.push(() => {
      disposed = true
      cover?.dispose()
    })

    /* لمسة في أي مكان = نفس اللي بيعمله الزر: أول لمسة بتشغّل الفيديو
       المستني، واللمسة اللي بعدها بتفتح الدعوة. */
    const onTouch = (e: Event) => {
      if (cover?.handled(e)) return // الضغطة دي ملك كود الافتتاحية
      if (isAwaiting) {
        startManual?.()
        return
      }
      guestOpen()
    }
    intro.addEventListener('click', onTouch)
    cleanup.push(() => intro.removeEventListener('click', onTouch))
    if (!locked) intro.style.cursor = 'pointer'

    return () => {
      cleanup.forEach((fn) => fn())
      if (timer) clearTimeout(timer)
      if (stallTimer) clearTimeout(stallTimer)
      document.body.style.overflow = prevOverflow
      delete window.__lbIntro
    }
    // الإعدادات بتتقرا مرة عند التركيب — الافتتاحية بتتشال بعد الفتح
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (gone) return null

  const label = data.playLabel || t('intro.play')
  const cls = ['lb-intro']
  if (data.video) cls.push('lb-intro--video')
  if (open) cls.push('is-open')
  if (awaiting) cls.push('is-awaiting-play')
  if (blocked) cls.push('is-video-blocked')
  const items = data.itemStyles
  // الغلاف ‎<img>‎ عادية تحت الفيديو، مش خاصية ‎poster‎ ولا خلفية: لما الاتنين كانوا
  // مع بعض المتصفح كان بيبدّل بينهم مع كل ضغطة (حركة الدقّة بترفع الطبقة) فبتظهر
  // وميض بين لونين. دلوقتي مصدر واحد ثابت، والفيديو بيظهر بعد أول فريم بيتشغّل.
  const poster = data.poster ? <img className="lb-intro-poster" src={data.poster} alt="" aria-hidden="true" /> : null
  const videoLive = data.poster ? (live ? '1' : '0') : undefined

  return (
    <div
      ref={root}
      className={cls.join(' ')}
      data-intro-auto={data.seconds ? String(data.seconds) : undefined}
      style={parseStyle(data.style)}
    >
      {data.video && poster}
      {data.video &&
        (manual ? (
          <video
            ref={video}
            className="lb-intro-video"
            data-intro-video
            data-intro-manual
            data-intro-audio={data.audio}
            data-live={videoLive}
            src={data.video}
            muted={data.audio !== 'sound'}
            playsInline
            preload="auto"
          />
        ) : (
          <video
            ref={video}
            className="lb-intro-video"
            data-intro-video
            data-intro-audio={data.audio}
            data-live={videoLive}
            src={data.video}
            autoPlay={!selfPlay}
            muted={data.audio !== 'sound'}
            playsInline
            preload="auto"
          />
        ))}
      {manual &&
        (data.playMode === 'button' ? (
          <button
            ref={playBtn}
            type="button"
            data-intro-play
            data-intro-item="play"
            className="lb-intro-play lb-intro-play--plain"
            aria-label={label}
            style={parseStyle(items.play)}
          >
            {label}
          </button>
        ) : (
          <button
            ref={playBtn}
            type="button"
            data-intro-play
            data-intro-item="play"
            className={`lb-intro-play${data.playLabel ? ' lb-intro-play--label' : ''}`}
            aria-label={label}
            style={parseStyle(items.play)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.2v13.6L19 12 8 5.2Z" />
            </svg>
            {data.playLabel && <span className="lb-intro-play-text">{data.playLabel}</span>}
          </button>
        ))}
      <div className="lb-intro-inner">
        {data.note && (
          <p className="lb-kicker" data-intro-item="note" style={parseStyle(items.note)}>
            {data.note}
          </p>
        )}
        {data.guestName && (
          <p className="lb-intro-name" data-intro-item="guest_name" style={parseStyle(items.guest_name)}>
            {t('intro.hello', { name: data.guestName })}
          </p>
        )}
        {data.text && (
          <p className="lb-body" data-intro-item="text" style={parseStyle(items.text)}>
            {data.text}
          </p>
        )}
        {data.button && !locked && (
          <button
            ref={openBtn}
            type="button"
            className="lb-btn lb-btn--solid"
            data-intro-item="button"
            data-intro-open
            style={parseStyle(items.button)}
          >
            {data.button}
          </button>
        )}
        <Raw html={codeHtml(data)} />
      </div>
    </div>
  )
}
