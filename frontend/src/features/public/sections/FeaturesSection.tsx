import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { prefersReducedMotion } from '../motion'

type FeatureKey = 'countdown' | 'gallery' | 'rsvp' | 'whatsapp' | 'music' | 'maps' | 'qr' | 'calendar' | 'venueQr'

const ICONS: Record<FeatureKey, ReactNode> = {
  countdown: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m5 17 4.5-4 3 2.5 2-2 4.5 3.5" />
    </>
  ),
  rsvp: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12 2.5 2.5L16.5 9" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20 4 4.5 10.2c-.8.3-.8 1.4 0 1.7l5.1 1.9 1.9 5.1c.3.8 1.4.8 1.7 0L20 4Z" />
      <path d="m9.7 13.8 4.2-4.2" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </>
  ),
  maps: (
    <>
      <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.3" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />
    </>
  ),
  calendar: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </>
  ),
  venueQr: (
    <>
      <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4z" />
      <path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z" />
    </>
  ),
}

/* عمودين حوالين الموبايل + ميزة يوم الفرح تحته. الترتيب ده هو ترتيب اللفّ التلقائي كمان. */
const SIDE_A: FeatureKey[] = ['countdown', 'calendar', 'whatsapp', 'qr']
const SIDE_B: FeatureKey[] = ['gallery', 'music', 'maps', 'rsvp']
const ORDER: FeatureKey[] = [...SIDE_A, ...SIDE_B, 'venueQr']

const TICK_MS = 2800

/* موعد وهمي بعد ٢٤ يوم — واحد للصفحة كلها، فأي عدّاد فيها بيقول نفس الرقم */
const TARGET = Date.now() + ((24 * 24 + 10) * 60 + 35) * 60 * 1000

/**
 * عدّاد حقيقي بيشتغل بس والقسم ظاهر. التكّة متظبطة على حدود الثانية بالظبط (مش ‎setInterval‎
 * اللي بيزحف)، فالعدّاد اللي في الموبايل واللي في الكارت بيقلبوا في نفس اللحظة.
 * كل عدّاد مكوّن لوحده، فالتكّة بترسم الأرقام بس مش المشهد كله.
 */
function useCountdown(running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    let id = 0
    const tick = () => {
      setNow(Date.now())
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 8)
    }
    tick()
    return () => window.clearTimeout(id)
  }, [running])
  const s = Math.floor(Math.max(0, TARGET - now) / 1000)
  return [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
}

const ar = (n: number) => n.toLocaleString('ar-EG', { minimumIntegerDigits: 2, useGrouping: false })

function Icon({ k }: { k: FeatureKey }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[k]}
    </svg>
  )
}

const COUNT_LABELS = ['يوم', 'ساعة', 'دقيقة', 'ثانية']

/** الموبايل اللي في النص: دعوة مصغّرة كل جزء فيها مربوط بميزة. زخرفة بحتة لقارئ الشاشة. */
function CountTiles({ running }: { running: boolean }) {
  const count = useCountdown(running)
  return count.map((n, i) => (
    <span key={COUNT_LABELS[i]}>
      <b>{ar(n)}</b>
      <small>{COUNT_LABELS[i]}</small>
    </span>
  ))
}

/** ‎memo‎: بيترسم من جديد بس لما الميزة النشطة أو حالة الظهور تتغيّر */
const PhoneMock = memo(function PhoneMock({
  active,
  running,
  spotlight = false,
}: {
  active: FeatureKey
  running: boolean
  spotlight?: boolean
}) {
  const on = (k: FeatureKey) => (active === k ? ' is-on' : '')
  return (
    <div className={'fx-phone' + (spotlight ? ' fx-phone--spot' : '')} aria-hidden="true">
      <span className="fx-phone-notch" />
      <div className="fx-screen">
        <p className="fx-inv-eyebrow">دعوة زفاف</p>
        <p className="fx-inv-names">
          أحمد <i>&amp;</i> مريم
        </p>
        <p className="fx-inv-date">الخميس · ١٢ ديسمبر ٢٠٢٦</p>

        <div data-f="countdown" className={'fx-part fx-count' + on('countdown')}>
          <CountTiles running={running} />
        </div>

        <div data-f="gallery" className={'fx-part fx-shots' + on('gallery')}>
          <span />
          <span />
          <span />
        </div>

        <div data-f="music" className={'fx-part fx-music' + on('music')}>
          <span className="fx-play" />
          <span className="fx-eq">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <small>أغنية الزفة</small>
        </div>

        <div data-f="maps" className={'fx-part fx-map' + on('maps')}>
          <Icon k="maps" />
          <span>
            <b>قاعة الماسة</b>
            <small>اضغط للاتجاهات</small>
          </span>
        </div>

        <div className="fx-actions">
          <span data-f="rsvp" className={'fx-part fx-rsvp' + on('rsvp')}>
            تأكيد الحضور
          </span>
          <span data-f="calendar" className={'fx-part fx-mini' + on('calendar')}>
            <Icon k="calendar" />
          </span>
          <span data-f="whatsapp" className={'fx-part fx-mini' + on('whatsapp')}>
            <Icon k="whatsapp" />
          </span>
        </div>

        <div className="fx-qrs">
          <span data-f="qr" className={'fx-part fx-qr' + on('qr')}>
            <Icon k="qr" />
            <small>رابط الدعوة</small>
          </span>
          <span data-f="venueQr" className={'fx-part fx-qr' + on('venueQr')}>
            <Icon k="venueQr" />
            <small>دخول القاعة</small>
          </span>
        </div>
      </div>
    </div>
  )
})

function FeatureItem({ k, active, onPick }: { k: FeatureKey; active: boolean; onPick: (k: FeatureKey) => void }) {
  const { t } = useTranslation()
  return (
    // النشاط في ‎data-on‎ مش في الكلاس عشان React مايمسحش أي كلاس تاني على العنصر
    <li className="fx-item" data-on={active || undefined} onMouseEnter={() => onPick(k)}>
      <span className="fx-gem">
        <Icon k={k} />
      </span>
      <span className="fx-copy">
        <h3>{t(`public.features.${k}.title`)}</h3>
        <p>{t(`public.features.${k}.text`)}</p>
      </span>
    </li>
  )
}

/** ‎matchMedia‎ كـstate — في jsdom ومن غير ‎matchMedia‎ بترجع ‎false‎. */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const update = () => setMatch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return match
}

const PHONE_H = 524 // ارتفاع الموبايل الطبيعي (268 × 17.6 / 9)

/* QR شكلي ١١×١١: ٣ مربعات تحديد في الأركان + نقط ثابتة (مش عشوائية عشان الشكل مايتغيرش) */
const QR_CELLS: [number, number][] = []
for (let y = 0; y < 11; y++)
  for (let x = 0; x < 11; x++) {
    const finder = (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7)
    if (!finder && (x * 7 + y * 13 + x * y) % 5 < 2) QR_CELLS.push([x, y])
  }
function QrGlyph() {
  return (
    <svg className="qr-glyph" viewBox="-.5 -.5 12 12" aria-hidden="true" focusable="false">
      {[
        [0, 0],
        [8, 0],
        [0, 8],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <rect
            x={x + 0.25}
            y={y + 0.25}
            width="2.5"
            height="2.5"
            rx=".4"
            fill="none"
            stroke="currentColor"
            strokeWidth=".5"
          />
          <rect x={x + 1} y={y + 1} width="1" height="1" />
        </g>
      ))}
      {QR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width=".84" height=".84" rx=".18" />
      ))}
    </svg>
  )
}

/** مشهد صغير مجسّم لكل ميزة — بيشتغل بس وهو الكارت الحالي (CSS على ‎[data-state="cur"]‎). */
function ArtCount({ running }: { running: boolean }) {
  const count = useCountdown(running)
  return (
    <div className="art art-count">
      {count.map((n, i) => (
        <span key={COUNT_LABELS[i]}>
          {/* ‎key‎ بالرقم: كل ما الرقم يتغيّر بيتركّب من جديد فيقلب زي ساعة المطار */}
          <b key={n}>{ar(n)}</b>
          <small>{COUNT_LABELS[i]}</small>
        </span>
      ))}
    </div>
  )
}

function FeatureArt({ k, running }: { k: FeatureKey; running: boolean }) {
  switch (k) {
    case 'countdown':
      return <ArtCount running={running} />
    case 'gallery':
      return (
        <div className="art art-gallery">
          <i />
          <i />
          <i />
        </div>
      )
    case 'music':
      return (
        <div className="art art-music">
          <span className="disc">
            <i />
          </span>
          <span className="arm" />
          <em>♪</em>
          <em>♫</em>
          <em>♪</em>
        </div>
      )
    case 'maps':
      return (
        <div className="art art-map">
          <span className="ground">
            <i className="road road--a" />
            <i className="road road--b" />
            <i className="ripple" />
          </span>
          <span className="pin">
            <Icon k="maps" />
          </span>
          <span className="pin-shadow" />
        </div>
      )
    case 'rsvp':
      return (
        <div className="art art-rsvp">
          <span className="press">
            <b>تأكيد الحضور</b>
            <b>✓ تم التأكيد</b>
          </span>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <i key={i} style={{ ['--a' as string]: `${i * 45}deg` }} />
          ))}
        </div>
      )
    case 'calendar':
      return (
        <div className="art art-cal">
          <span className="cal">
            <b className="cal-head">ديسمبر ٢٠٢٦</b>
            <b className="cal-day">١٢</b>
            <small>الخميس</small>
          </span>
          <span className="cal-sheet" />
          <span className="cal-badge">+ اتضاف للتقويم</span>
        </div>
      )
    case 'whatsapp':
      return (
        <div className="art art-wa">
          <span className="bubble">
            دعوة فرح أحمد ومريم 💌
            <small>✓✓</small>
          </span>
          <span className="plane">
            <Icon k="whatsapp" />
          </span>
        </div>
      )
    case 'qr':
      return (
        <div className="art art-qr">
          <span className="qr-card">
            <QrGlyph />
            <i className="laser" />
          </span>
        </div>
      )
    case 'venueQr':
      return (
        <div className="art art-ticket">
          <span className="ticket">
            <QrGlyph />
            <span>
              <b>دخول القاعة</b>
              <small>ضيف · طاولة ٧</small>
            </span>
          </span>
          <span className="stamp">تم الدخول</span>
        </div>
      )
  }
}

const LINK_GAP = 44 // طول السهم — نفس ‎--gap‎ في sections.css

/** كارت ميزة في المشهد. ‎memo‎: لما الميزة تتغيّر بيترسم بس الكارتين اللي حالتهم اتغيّرت. */
const ShowCard = memo(function ShowCard({
  f,
  i,
  state,
  running,
  title,
  text,
}: {
  f: FeatureKey
  i: number
  state: 'cur' | 'past' | 'next'
  running: boolean
  title: string
  text: string
}) {
  return (
    <div className="fx-show" data-f={f} data-state={state}>
      {/* السهم من العنصر للكارت؛ مكانه واتجاهه (‎data-place‎) بيتقاسوا في ‎fit()‎ */}
      <span className="fx-link">
        <i className="fx-link-dot" />
        <i className="fx-link-line" />
        <i className="fx-link-head" />
      </span>
      <span className="fx-cap-num">
        {ar(i + 1)} / {ar(ORDER.length)}
      </span>
      <div className="fx-art-box">
        <FeatureArt k={f} running={running} />
      </div>
      <b>{title}</b>
      <small>{text}</small>
    </div>
  )
})

/**
 * التليفون: مشهد سينمائي ثلاثي الأبعاد بالضغط. الموبايل واقف بزاوية مجسّمة وبيطفو بهدوء؛ كل
 * ضغطة على المشهد بتعرض الميزة اللي بعدها (وبعد آخر ميزة بترجع للأولى): جزءها في الدعوة بينوّر
 * وبيطلع منه كارت معاينة صغير بسهم فيه مشهد خاص بيها.
 * السكرول بتاع الصفحة مالوش أي دعوة بالقسم — مفيش تثبيت ولا snap (النسخ اللي فاتت كانت بتهنّج
 * على آيفون). علامة الضغط (صباع بيدوس + «اضغط للميزة التالية») بتوضّح للزائر يعمل إيه، وبعد
 * أول ضغطة بتصغر. النقط تحت بتنقل لأي ميزة على طول.
 * الحركات اللي بتلف على طول (الهالة، الطفو، اللمعة...) بتقف والقسم برّه الشاشة.
 */
function FeaturesScene() {
  const { t } = useTranslation()
  const track = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tapped, setTapped] = useState(false)
  const N = ORDER.length
  const last = idx === N - 1

  useEffect(() => {
    const el = track.current
    const sticky = el?.querySelector<HTMLElement>('.fx-sticky')
    if (!el || !sticky) return
    const fit = () => {
      // الموبايل ياخد ~٧٤٪ من ارتفاع المساحة الثابتة ومايعدّيش عرض الشاشة
      const z = Math.max(0.55, Math.min(0.92, (sticky.offsetHeight * 0.74) / PHONE_H, (window.innerWidth - 110) / 268))
      el.style.setProperty('--fx-zoom', String(z))
      // مكان كل كارت وسهمه بالنسبة لعنصره في الموبايل. القياس بيتعمل والمشهد من غير زاوية
      // ولا طفو (‎.fx-measuring‎)، فالأرقام بتطلع في مستوى الموبايل نفسه — هو ده اللي الكارت
      // والسهم بيتحطوا فيه، فالسهم بيقع على العنصر بالظبط.
      const rig = el.querySelector<HTMLElement>('.fx-rig')
      if (!rig) return
      el.classList.add('fx-measuring')
      const box = rig.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      el.querySelectorAll<HTMLElement>('.fx-show').forEach((card) => {
        const part = rig.querySelector<HTMLElement>(`.fx-phone [data-f="${card.dataset.f}"]`)
        if (!part) return
        const r = part.getBoundingClientRect()
        const mid = r.top + r.height / 2
        // العنصر في النص العلوي ← الكارت تحته؛ في النص السفلي ← الكارت فوقه
        const below = mid - box.top < box.height * 0.45
        const y = below ? r.bottom - cy + LINK_GAP : r.top - cy - LINK_GAP - card.offsetHeight
        card.dataset.place = below ? 'below' : 'above'
        card.style.setProperty('--card-y', `${Math.round(y)}px`)
        card.style.setProperty('--dx', `${Math.round(r.left + r.width / 2 - cx)}px`)
        card.style.setProperty('--from-y', `${Math.round(mid - cy)}px`)
      })
      el.classList.remove('fx-measuring')
    }
    // ظاهر ولا لأ — من غير أي listener على السكرول
    const io =
      'IntersectionObserver' in window
        ? new IntersectionObserver(([e]) => {
            setVisible(e.isIntersecting)
            el.classList.toggle('is-visible', e.isIntersecting)
          })
        : null
    io?.observe(el)
    if (!io) {
      setVisible(true)
      el.classList.add('is-visible')
    }
    fit()
    // الخطوط (Amiri) لو وصلت بعد أول قياس بتغيّر ارتفاع الكارت — نقيس تاني
    document.fonts?.ready.then(fit)
    window.addEventListener('resize', fit)
    return () => {
      io?.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [])

  const go = (i: number) => {
    setIdx(i)
    setTapped(true)
  }

  return (
    <>
      <div className="fx-track" ref={track}>
        <div className="fx-sticky">
          <div className="fx-scene">
            {/* ‎.fx-fit‎ بيصغّر المشهد كله بـ‎transform: scale‎ (مش ‎zoom‎ — سفاري بيقيس ‎zoom‎ غلط
                فالكروت والأسهم كانت بتقع في أماكن غلط على آيفون) */}
            <div className="fx-fit">
            <div className="fx-rig">
              <span className="fx-halo" aria-hidden="true" />
              <PhoneMock active={ORDER[idx]} running={visible} spotlight />
              <div className="fx-shows" aria-hidden="true">
                {ORDER.map((f, i) => (
                  <ShowCard
                    key={f}
                    f={f}
                    i={i}
                    state={i === idx ? 'cur' : i < idx ? 'past' : 'next'}
                    running={visible && i === idx}
                    title={t(`public.features.${f}.title`)}
                    text={t(`public.features.${f}.text`)}
                  />
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>
        {/* المشهد كله زرار واحد: الضغط في أي حتة = الميزة اللي بعدها */}
        <button
          type="button"
          className="fx-tap"
          onClick={() => go((idx + 1) % N)}
          aria-label={last ? 'ارجع لأول ميزة' : 'اعرض الميزة التالية'}
        >
          <span className={'fx-hint' + (tapped ? ' is-quiet' : '')} aria-hidden="true">
            <span className="fx-hint-hand">
              <i />
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M9.5 11.5V5a1.5 1.5 0 0 1 3 0v5.5m0-1.2a1.5 1.5 0 0 1 3 0v1.7m0-1a1.5 1.5 0 0 1 3 0v4.3a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.9-2.5l-2.6-3.6a1.5 1.5 0 0 1 2.4-1.8l1.6 2.1" />
              </svg>
            </span>
            <span className="fx-hint-text">{last ? 'اضغط للبداية من جديد' : 'اضغط للميزة التالية'}</span>
          </span>
        </button>
        {/* النقط: كل نقطة بتنقل لميزتها */}
        <ol className="fx-dots">
          {ORDER.map((f, i) => (
            <li key={f}>
              <button
                type="button"
                className={i === idx ? 'on' : i < idx ? 'done' : undefined}
                onClick={() => go(i)}
                aria-label={t(`public.features.${f}.title`)}
                aria-current={i === idx || undefined}
              />
            </li>
          ))}
        </ol>
      </div>
      {/* المشهد كله زخرفة؛ قارئ الشاشة بيقرا القايمة دي */}
      <ul className="sr-only">
        {ORDER.map((f) => (
          <li key={f}>
            {t(`public.features.${f}.title`)}: {t(`public.features.${f}.text`)}
          </li>
        ))}
      </ul>
    </>
  )
}

/** المميزات: موبايل فيه دعوة مصغّرة في النص، والمميزات حواليه؛ كل ميزة بتنوّر جزءها في الدعوة. */
export function FeaturesSection() {
  const { t } = useTranslation()
  // المشهد السينمائي للتليفون بس؛ مع «تقليل الحركة» بيفضل شكل الكروت العادي
  const cinematic = useMedia('(max-width: 860px)') && !prefersReducedMotion()
  const stage = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<FeatureKey>('countdown')
  const [visible, setVisible] = useState(false)
  const [paused, setPaused] = useState(false)

  // العدّاد واللفّ بيشتغلوا بس والقسم على الشاشة — مفيش تايمر شغّال على الفاضي
  useEffect(() => {
    const el = stage.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.2,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [cinematic])

  // لفّ تلقائي على المميزات؛ بيقف والماوس فوق القسم أو لو «تقليل الحركة» مفعّل
  useEffect(() => {
    if (cinematic || !visible || paused || prefersReducedMotion()) return
    const id = window.setInterval(() => {
      setActive((cur) => ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length])
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [cinematic, visible, paused])

  const item = (k: FeatureKey) => <FeatureItem key={k} k={k} active={active === k} onPick={setActive} />

  return (
    <section className="section section--features" id="features">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">{t('public.features.eyebrow')}</p>
          <h2>{t('public.features.title')}</h2>
          <p>{t('public.features.sub')}</p>
        </div>
        {cinematic ? (
          <FeaturesScene />
        ) : (
          <div
            className="fx-stage"
            ref={stage}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <ul className="fx-side fx-side--a">{SIDE_A.map(item)}</ul>
            <div className="fx-center">
              <span className="fx-halo" aria-hidden="true" />
              <PhoneMock active={active} running={visible} />
            </div>
            <ul className="fx-side fx-side--b">{SIDE_B.map(item)}</ul>
            <ul className="fx-side fx-side--c">{item('venueQr')}</ul>
          </div>
        )}
      </div>
    </section>
  )
}
