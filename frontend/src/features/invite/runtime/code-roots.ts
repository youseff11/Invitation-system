/**
 * حمايات كود المصمّم — نسخة من ‎invite.js‎ (‎guardCodeRoots‎ و‎runSectionScripts‎).
 *
 * جذور كود المصمّم: «كود متقدّم» في قسم، وكود الافتتاحية، والقسم المستورد.
 * أي حماية أو إعادة تشغيل بتتطبّق على التلاتة مع بعض.
 */
export const CODE_ROOTS = '.lb-extra-html, .lb-intro-extra, .lb-custom'

interface FarhaState {
  state?: Record<string, unknown>
}
declare global {
  interface Window {
    farha?: FarhaState
  }
}

/** حالة بتفضل عايشة لكود الأقسام حتى لو المحتوى اتعاد بناؤه (‎window.farha.state‎). */
export function initFarhaState() {
  window.farha = window.farha || {}
  if (!window.farha.state) window.farha.state = {}
}

const guarded = new WeakSet<Element>()

/**
 * حماية من إعادة التحميل غير المقصودة: زرار جوّه ‎<form>‎ من غير ‎type‎ بياخد
 * ‎submit‎ افتراضياً، والمنقّي بيشيل ‎action‎ فالإرسال بيروح لنفس الصفحة ⇒
 * إعادة تحميل كاملة. الكود اللي عايز يبعت فعلاً بيكتب ‎action‎ صريح.
 */
export function guardCodeRoots(scope: ParentNode = document) {
  scope.querySelectorAll(CODE_ROOTS).forEach((codeRoot) => {
    if (guarded.has(codeRoot)) return
    guarded.add(codeRoot)

    codeRoot.querySelectorAll('button').forEach((btn) => {
      if (!btn.hasAttribute('type')) btn.setAttribute('type', 'button')
    })
    codeRoot.querySelectorAll('form').forEach((form) => {
      if (form.getAttribute('action')) return
      form.addEventListener('submit', (e) => e.preventDefault())
    })
    // ‎<a href="">‎ بيروح لنفس الصفحة (إعادة تحميل)، و‎href="#"‎ بينطّ لفوق
    codeRoot.querySelectorAll('a').forEach((link) => {
      const href = (link.getAttribute('href') || '').trim()
      if (href && href !== '#') return
      link.addEventListener('click', (e) => e.preventDefault())
    })
  })
}

const ran = new WeakSet<Element>()

/**
 * سكربتات الأقسام اللي اتحقنت بـ‎innerHTML‎ مابتتنفّذش: بنستنسخها كوسوم جديدة
 * عشان تتنفّذ، و‎document.currentScript‎ يفضل مظبوط فـ‎root‎ اللي في ‎wrap_js‎
 * يلاقي قسمه.
 */
export function runSectionScripts(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLScriptElement>('script[data-lb-section-script]').forEach((old) => {
    if (!old.parentNode || ran.has(old)) return
    const fresh = document.createElement('script')
    fresh.setAttribute('data-lb-section-script', '1')
    fresh.textContent = old.textContent
    ran.add(fresh)
    old.parentNode.replaceChild(fresh, old)
  })
}
