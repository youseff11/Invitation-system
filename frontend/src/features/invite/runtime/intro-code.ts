/**
 * افتتاحية مكتوبة كلها بـ«كود متقدّم» — نسخة من ‎initIntro‎ في ‎invite.js‎.
 *
 * في افتتاحيات المصمّم بتغطّي الشاشة كلها بطبقة خاصة بيها (خلفية + كارت + زرار)
 * وبتعمل حركة وبعدين تخفي نفسها. فيه مشكلتين:
 * ١. الكود بيخفي طبقته بس ومابيقولناش، فالضيف بيفضل قدام خلفية ‎.lb-intro‎ الفاضية.
 * ٢. أي ضغطة برّه زرار الكود بتفتح على طول، والحركة ماتظهرش خالص.
 *
 * الحل: طول ما فيه «غطا» من الكود ظاهر، الكود هو اللي ماسك الفتح:
 * - الضغطة على زرار جوّه الغطا بتروح له زي ما هي.
 * - الضغطة على أي حتة تانية بتتحوّل لزرار الغطا لو ليه زرار واحد بس.
 * - أول ما الغطا يختفي (اتشال، ‎display:none‎، شفاف، بدأ يبهت لـ٠، أو خرج
 *   من الشاشة) نفتح الدعوة.
 * - لو الكود ماعملش أي حاجة خالصة بعد الضغطة نفتح زي الأول، عشان الضيف
 *   مايتحبسش قدام كود مش بيرد.
 */
const CODE_CONTROLS = 'button, [role=button], a[href], input[type=button], input[type=submit]'

interface Api {
  open: () => void
  isOpen: () => void | boolean
}

function alphaOf(color: string): number {
  const m = /rgba?\(([^)]+)\)/.exec(color || '')
  if (!m) return color === 'transparent' ? 0 : 1
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  return parts.length > 3 ? parseFloat(parts[3]) : 1
}

/** العنصر بيبهت لـ٠ دلوقتي؟ بنفتح مع **بداية** البهتان مش آخره. */
function fadingOut(el: Element): boolean {
  if (!el.getAnimations) return false
  try {
    return el.getAnimations().some((a) => {
      if (a.playState !== 'running' && a.playState !== 'finished') return false
      const effect = a.effect
      const timing = effect && effect.getTiming ? effect.getTiming() : {}
      if (timing.iterations === Infinity) return false // نبض أو وميض
      const kf = (effect as KeyframeEffect).getKeyframes()
      const last = kf[kf.length - 1]
      return !!last && last.opacity !== undefined && parseFloat(String(last.opacity)) < 0.05
    })
  } catch {
    return false
  }
}

function coverShown(el: Element, box: Element): boolean {
  if (getComputedStyle(el).visibility === 'hidden') return false
  for (let n: Element | null = el; n && n !== box.parentNode; n = n.parentElement) {
    if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false
    if (fadingOut(n)) return false
  }
  return true
}

/** الطبقة اللي كود الافتتاحية مغطّي بيها الشاشة، أو null. */
function codeCover(intro: HTMLElement): Element | null {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let found: Element | null = null
  Array.from(intro.querySelectorAll('.lb-intro-extra')).some((box) =>
    Array.from(box.querySelectorAll('*')).some((el) => {
      const r = el.getBoundingClientRect()
      if (r.width < vw * 0.9 || r.height < vh * 0.9) return false
      if (r.left > vw * 0.05 || r.top > vh * 0.05 || r.right < vw * 0.95 || r.bottom < vh * 0.95) return false
      // طبقة شفافة (ورد بيقع، كونفيتي) مش غطا
      const cs = getComputedStyle(el)
      const paints =
        cs.backgroundImage !== 'none' || alphaOf(cs.backgroundColor) > 0.5 || /^(IMG|VIDEO)$/.test(el.tagName)
      if (!paints || !coverShown(el, box)) return false
      found = el
      return true
    }),
  )
  return found
}

function codeControls(cover: Element): HTMLElement[] {
  return Array.from(cover.querySelectorAll<HTMLElement>(CODE_CONTROLS)).filter((c) => {
    if ((c as HTMLButtonElement).disabled || c.closest('[data-intro-open],[data-intro-play]')) return false
    return c.getClientRects().length > 0 && getComputedStyle(c).visibility !== 'hidden'
  })
}

/** يربط منطق الغطا. بيرجّع ‎handled(e)‎: الضغطة دي ملك كود الافتتاحية؟ */
export function bindCodeCover(intro: HTMLElement, api: Api) {
  let armed = false // الضيف ضغط والغطا ظاهر
  let handed: Event | null = null // الضغطة اللي اتسلّمت للكود، مانفتحش بيها
  let forwarding = false
  let mutations = 0
  let check = 0
  let reaction: number | null = null
  let playAnnounced = false
  const cleanup: (() => void)[] = []

  /** الغطا راح؟ نستنى تكّة ونتأكد — في افتتاحيات بمراحل الغطا الأول بيختفي والتاني بيظهر. */
  const checkCover = () => {
    check = 0
    if (!armed || api.isOpen()) return
    if (codeCover(intro)) return
    window.setTimeout(() => {
      if (!api.isOpen() && !codeCover(intro)) api.open()
    }, 120)
  }
  const scheduleCheck = () => {
    if (!armed || check) return
    check = window.requestAnimationFrame(checkCover)
  }

  /** الكود رد على الضغطة؟ أي تغيير في الـDOM أو حركة محدودة شغالة يعتبر رد. */
  const expectReaction = () => {
    if (reaction) return
    const before = mutations
    reaction = window.setTimeout(() => {
      reaction = null
      if (api.isOpen() || mutations !== before) return
      let busy = false
      try {
        busy = intro.getAnimations({ subtree: true }).some((a) => {
          const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}
          return a.playState === 'running' && timing.iterations !== Infinity
        })
      } catch {
        /* مش حرج */
      }
      if (!busy) api.open()
    }, 700)
  }

  if (window.MutationObserver) {
    const mo = new MutationObserver(() => {
      mutations++
      scheduleCheck()
    })
    mo.observe(intro, { subtree: true, childList: true, attributes: true })
    cleanup.push(() => mo.disconnect())
  }
  intro.addEventListener('transitionend', scheduleCheck)
  intro.addEventListener('animationend', scheduleCheck)
  const onOpened = () => {
    if (reaction) {
      clearTimeout(reaction)
      reaction = null
    }
  }
  document.addEventListener('lb:intro-open', onOpened)

  /** مرحلة الالتقاط: بنوصل قبل زرار الكود، فحتى لو عمل stopPropagation بنعرف إن الضيف ضغط. */
  const onCapture = (e: Event) => {
    if (api.isOpen()) return
    if (forwarding) {
      handed = e
      return
    }
    const cover = codeCover(intro)
    if (!cover) return // مفيش غطا — السلوك القديم

    armed = true
    handed = e
    // الأغنية تبدأ مع الضغطة نفسها (سفاري محتاجها جوّه مكدس الضغطة)
    if (!playAnnounced) {
      playAnnounced = true
      document.dispatchEvent(new CustomEvent('lb:intro-play'))
    }

    const target = e.target as Element | null
    const hit = target && target.closest ? target.closest(CODE_CONTROLS) : null
    if (!(hit && cover.contains(hit))) {
      const controls = codeControls(cover)
      if (controls.length === 1) {
        e.stopPropagation()
        e.preventDefault()
        forwarding = true
        try {
          controls[0].click()
        } finally {
          forwarding = false
        }
      } else if (!cover.contains(target)) {
        // الغطا عامل pointer-events:none وهو بيتحرّك فالضغطة عدّت لتحت
        e.stopPropagation()
        e.preventDefault()
      }
      // غير كده: الكود ممكن يكون مستمع على الغطا نفسه، فنسيبها توصل له
    }
    expectReaction()
  }
  intro.addEventListener('click', onCapture, true)

  return {
    handled: (e: Event) => handed === e,
    dispose() {
      cleanup.forEach((fn) => fn())
      intro.removeEventListener('transitionend', scheduleCheck)
      intro.removeEventListener('animationend', scheduleCheck)
      intro.removeEventListener('click', onCapture, true)
      document.removeEventListener('lb:intro-open', onOpened)
      if (reaction) clearTimeout(reaction)
      if (check) cancelAnimationFrame(check)
    },
  }
}
