import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { useInvite } from '../context'
import { queueMedia, resetPrimed, setWanted } from '../runtime/media'
import type { BlockData } from '../types'
import { Frame } from './Frame'

interface VideoProps {
  url?: string
  poster?: string
  heading?: string
  aspect?: string
  autoplay?: boolean
  sound?: boolean
  loop?: boolean
  overlays?: string[]
}

const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/
const VIMEO = /vimeo\.com\/(\d+)/

interface MusicHandle {
  audio?: HTMLAudioElement
  play: () => void
  pause: () => void
}

/** يوطّي الموسيقى وقت الفيديو الصوتي ويرجّعها لما يقف — ولو كانت مقفولة ماتتلمسش. */
function useDuck() {
  const ducked = useRef(false)
  return {
    duck() {
      const m = (window as unknown as { __lbMusic?: MusicHandle | null }).__lbMusic
      if (m && m.audio && !m.audio.paused) {
        ducked.current = true
        m.pause()
      }
    },
    unduck() {
      if (!ducked.current) return
      ducked.current = false
      ;(window as unknown as { __lbMusic?: MusicHandle | null }).__lbMusic?.play()
    },
  }
}

/** ملف الفيديو بتاعنا: بنركّب ‎<video>‎ على طول بمشغّل المتصفح — نفس ‎initVideo‎. */
function FileVideo({
  holder,
  url,
  poster,
  autoplay,
  loop,
  sound,
}: {
  holder: React.RefObject<HTMLDivElement | null>
  url: string
  poster: string
  autoplay: boolean
  loop: boolean
  sound: boolean
}) {
  const { hasIntro } = useInvite()
  const ref = useRef<HTMLVideoElement>(null)
  const ducking = useDuck()
  // لمسة الضيف على «افتح الدعوة» هي إذن التشغيل الوحيد اللي بيسمح بصوت،
  // فطالما فيه افتتاحية بنستنّاها بدل ما نبدأ صامت.
  const withSound = autoplay && sound && hasIntro

  useEffect(() => {
    const v = ref.current
    const holderEl = holder.current
    if (!v) return
    const cleanup: (() => void)[] = []

    v.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback')
    v.disablePictureInPicture = true
    v.preload = poster ? 'none' : 'metadata'
    if (autoplay && !withSound) {
      v.muted = true
      v.autoplay = true
      v.preload = 'auto'
      // وضع التوفير في iOS بيرفض حتى ده: نحجزه في طابور فكّ القفل
      queueMedia(v)
    }

    // النسبة الحقيقية مابتتعرفش غير من الملف — بنبلّغ بيها الحاوية
    const onMeta = () => {
      if (v.videoWidth && v.videoHeight && holderEl) {
        holderEl.style.setProperty('--vid-ratio', `${v.videoWidth} / ${v.videoHeight}`)
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    cleanup.push(() => v.removeEventListener('loadedmetadata', onMeta))

    const tryPlay = () => {
      const p = v.play()
      if (!p || !p.catch) return
      p.catch(() => {
        // الرفض مش نهاية المطاف: بنرجّعه لطابور فكّ القفل فأي لمسة جاية بتشغّله
        resetPrimed(v)
        queueMedia(v)
      })
    }

    // الفيديو التلقائي مابيقفش بلمسة الضيف: بعض المتصفحات (متصفحات التطبيقات وسامسونج)
    // بتبدّل التشغيل/الإيقاف بلمسة على أي فيديو — لو وقف وهو على الشاشة نكمّله فوراً.
    // الإيقاف الوحيد المقصود هو لما القسم يعدّي من الشاشة (visible=false قبل pause)
    let visible = false
    const resume = () => {
      window.setTimeout(() => {
        if (visible && v.paused && !v.ended) tryPlay()
      }, 0)
    }

    // مانشغّلش كل فيديوهات الدعوة مع بعض: بيبدأ لما القسم يوصل للشاشة ويقف لما يعدّي
    const watch = () => {
      v.addEventListener('pause', resume)
      cleanup.push(() => v.removeEventListener('pause', resume))
      if (typeof IntersectionObserver !== 'function') {
        visible = true
        setWanted(v, true)
        tryPlay()
        return
      }
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            visible = en.isIntersecting
            if (en.isIntersecting) {
              setWanted(v, true)
              tryPlay()
            } else {
              setWanted(v, false)
              if (!v.paused) v.pause()
            }
          })
        },
        { threshold: 0.35 },
      )
      io.observe(v)
      cleanup.push(() => io.disconnect())
    }

    if (withSound) {
      const arm = () => {
        v.addEventListener('play', ducking.duck)
        v.addEventListener('pause', ducking.unduck)
        v.addEventListener('ended', ducking.unduck)
        watch()
      }
      const onOpen = () => {
        const p = v.play()
        if (!p || !p.then) {
          v.pause()
          arm()
          return
        }
        p.then(() => {
          v.pause()
          v.currentTime = 0
        })
          .catch(() => {
            v.muted = true
          })
          .then(arm, arm)
      }
      document.addEventListener('lb:intro-open', onOpen, { once: true })
      cleanup.push(() => document.removeEventListener('lb:intro-open', onOpen))
    } else if (autoplay) {
      watch()
    }

    // الفيديو من غير شريط تحكم دايماً: اللمسة عليه بتشغّله لو واقف (الفيديو غير التلقائي
    // ملوش طريقة تانية) — لكن مابتوقّفوش: الضغطة على فيديو شغّال ماتعملش حاجة.
    // المستمع على الحاوية والعنصر نفسه ‎pointer-events:none‎ (invite.css) عشان اللمسة
    // مانوصلش للفيديو أصلاً فمتصفح التطبيق ماتبدّلش تشغيله.
    const onClick = () => {
      if (!v.paused) return
      setWanted(v, true)
      tryPlay()
    }
    const tap = holderEl ?? v
    tap.style.cursor = 'pointer'
    tap.addEventListener('click', onClick)
    cleanup.push(() => tap.removeEventListener('click', onClick))

    return () => {
      cleanup.forEach((fn) => fn())
      v.removeEventListener('play', ducking.duck)
      v.removeEventListener('pause', ducking.unduck)
      v.removeEventListener('ended', ducking.unduck)
    }
    // الإعدادات بتتقرا مرة عند التركيب (زي القديم)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <video
      ref={ref}
      src={url}
      loop={loop}
      playsInline
      poster={poster || undefined}
      preload={poster ? 'none' : 'metadata'}
    />
  )
}

/** يوتيوب وفيميو: مانحمّلش مشغّلات الطرف الثالث إلا بضغطة (أسرع وأحسن للخصوصية). */
function EmbedVideo({
  yt,
  vimeo,
  poster,
  loop,
}: {
  yt: string
  vimeo: string
  poster: string
  loop: boolean
}) {
  const { t } = useInvite()
  const [started, setStarted] = useState(false)
  if (started) {
    const src = yt
      ? `https://www.youtube-nocookie.com/embed/${yt}?rel=0&autoplay=1&controls=0&modestbranding=1${
          loop ? `&loop=1&playlist=${yt}` : ''
        }`
      : `https://player.vimeo.com/video/${vimeo}?autoplay=1&controls=0`
    return (
      <iframe
        src={src}
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        title={t('video.title')}
      />
    )
  }
  const style = poster
    ? ({ '--poster': `url("${poster.replace(/"/g, '%22')}")` } as CSSProperties)
    : undefined
  return (
    <button
      type="button"
      className="lb-video-play"
      aria-label={t('video.play')}
      style={style}
      onClick={() => setStarted(true)}
    >
      <span>▶</span>
    </button>
  )
}

export function Video({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = block.props as VideoProps
  const holder = useRef<HTMLDivElement>(null)
  const url = p.url || ''
  const yt = url.match(YT)?.[1] ?? ''
  const vimeo = url.match(VIMEO)?.[1] ?? ''
  const aspect = p.aspect || '16x9'
  return (
    <Frame block={block}>
      {p.heading && (
        <h2 className="lb-heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      {url ? (
        <div data-move="video" className={`lb-video-wrap lb-video-wrap--${aspect}`}>
          <div
            ref={holder}
            className={`lb-video lb-video--${aspect}`}
            data-video={url}
            data-poster={p.poster || undefined}
            data-autoplay={p.autoplay ? '1' : undefined}
            data-sound={p.sound ? '1' : undefined}
            data-loop={p.loop ? '1' : undefined}
            data-no-controls="1"
          >
            {yt || vimeo ? (
              <EmbedVideo yt={yt} vimeo={vimeo} poster={p.poster || ''} loop={Boolean(p.loop)} />
            ) : (
              <FileVideo
                holder={holder}
                url={url}
                poster={p.poster || ''}
                autoplay={Boolean(p.autoplay)}
                loop={Boolean(p.loop)}
                sound={Boolean(p.sound)}
              />
            )}
          </div>
          {(p.overlays ?? []).map((html, i) => (
            <div key={i} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      ) : (
        <div className="lb-gempty">{t('empty.video')}</div>
      )}
    </Frame>
  )
}
