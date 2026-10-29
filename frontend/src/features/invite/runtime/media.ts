/**
 * فكّ قفل الوسائط — نسخة من ‎invite.js‎ (‎queueMedia/primeVideo/flushMedia‎).
 *
 * أهم فرق بين الموبايل والديسكتوب: وضع توفير الطاقة في iOS بيلغي التشغيل
 * التلقائي بالكامل — حتى الفيديو الصامت ‎playsinline‎. الرفض ده **على مستوى
 * العنصر مش الصفحة**: أول ما عنصر ‎<video>‎ يشتغل مرة واحدة جوّه مكدس لمسة
 * حقيقية، WebKit بيفكّه وبيسمح له يشتغل برمجياً بعد كده.
 *
 * فبدل ما نستنّى الفيديو يوصل للشاشة (واللمسة راحت)، بنسجّل كل فيديو معتمد
 * على التشغيل التلقائي في طابور، وأول لمسة حقيقية على الصفحة — وأهمها لمسة
 * «افتح الدعوة» — بنشغّله ونوقفه فوراً عشان ياخد الإذن ويكمّل بعد كده لوحده.
 */
const queue: HTMLVideoElement[] = []
let bound = false
const primed = new WeakSet<HTMLVideoElement>()
const wanted = new WeakSet<HTMLVideoElement>()

export function setWanted(v: HTMLVideoElement, on: boolean) {
  if (on) wanted.add(v)
  else wanted.delete(v)
}

export function resetPrimed(v: HTMLVideoElement) {
  primed.delete(v)
}

/** يشغّل العنصر ويوقفه فوراً — الهدف الإذن مش المشاهدة. */
function primeVideo(v: HTMLVideoElement) {
  if (primed.has(v)) return
  try {
    v.muted = true
    v.playsInline = true
    // التوفير بيخلّي preload فعلياً none، فالعنصر ممكن يكون فاضي لحظة اللمسة
    if (v.readyState === 0) {
      try {
        v.load()
      } catch {
        /* مش حرج */
      }
    }
    const p = v.play()
    const park = () => {
      primed.add(v)
      // لو العنصر ظاهر فعلاً في الشاشة سيبه شغال — ده مش تجهيز، ده عرض
      if (wanted.has(v)) return
      try {
        v.pause()
        v.currentTime = 0
      } catch {
        /* مش حرج */
      }
    }
    if (p && typeof p.then === 'function') p.then(park, () => queueMedia(v))
    else park()
  } catch {
    queueMedia(v)
  }
}

function flush() {
  if (!queue.length) return
  const batch = queue.splice(0)
  batch.forEach(primeVideo)
}

/**
 * ‎keepPlaying‎: الفيديو ده مالوش مراقب يشغّله بعدين (فيديو المصمّم في «كود
 * متقدّم» أو قسم مستورد) — فالتجهيز بالنسبة له هو التشغيل نفسه.
 */
export function queueMedia(v: HTMLVideoElement, keepPlaying = false) {
  if (!v || primed.has(v)) return
  if (keepPlaying) wanted.add(v)
  if (!queue.includes(v)) queue.push(v)
  if (bound) return
  bound = true
  // مرحلة الالتقاط عشان نسبق أي مستمع بيوقف الحدث (لمسة فتح الدعوة)
  ;['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => {
    document.addEventListener(ev, flush, { capture: true, passive: true })
  })
  document.addEventListener('lb:intro-open', flush)
}

/**
 * فيديوهات القوالب المستوردة: القالب المستورد قد يحتوي ‎<video>‎ خاماً بدون
 * ‎data-video‎ — بنفعّل الصامت بأمان من الـruntime بدون تشغيل أي JavaScript
 * مستورد. وفيديو «كود متقدّم» اللي طالب ‎autoplay‎ صراحةً بياخد نفس المعاملة.
 */
const bound$ = new WeakSet<HTMLVideoElement>()

export function initImportedMedia(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLVideoElement>('.lb-custom video').forEach((video) => {
    if (bound$.has(video)) return
    bound$.add(video)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.style.visibility = 'visible'
    const p = video.play()
    if (p && p.catch) p.catch(() => {})
    queueMedia(video, true)
  })
  scope
    .querySelectorAll<HTMLVideoElement>('.lb-extra-html video[autoplay], .lb-intro-extra video[autoplay]')
    .forEach((video) => {
      if (bound$.has(video)) return
      bound$.add(video)
      video.playsInline = true
      queueMedia(video, true)
    })
}
