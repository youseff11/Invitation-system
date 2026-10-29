/**
 * عدّادات وسكربتات القوالب المستوردة (Tilda وغيرها) — نسخة من ‎invite.js‎ و‎render.html‎.
 */
const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

interface ImportedTimers {
  __lbImportedCountdownTimer?: number | null
  __lbImportedCountdownObservers?: MutationObserver[]
}

const ALIASES: Record<string, string[]> = {
  days: ['days', 'day'],
  hours: ['hours', 'hour'],
  minutes: ['minutes', 'minute', 'mins', 'min'],
  seconds: ['seconds', 'second', 'secs', 'sec'],
}

function findSlot(root: Element, key: string): Element | null {
  for (const name of ALIASES[key] || [key]) {
    const selectors = [
      `.cd-${name}`,
      `#cd-${name}`,
      `[data-cd="${name}"]`,
      `[id$="-${name}"]`,
      `[class~="${name}"]`,
    ]
    for (const selector of selectors) {
      const found = root.querySelector(selector)
      if (found) return found
    }
  }
  return null
}

function numberNode(slot: Element | null): Element | null {
  if (!slot) return null
  if (slot.classList.contains('cd-num')) return slot
  return slot.querySelector('.cd-num, .cd-number, .number, [data-cd-number]') || slot
}

/** عدادات القوالب المستوردة: تعمل حتى لو سكربت القالب الأصلي خارجياً أو لا يطابق بنية المنصة. */
export function initImportedCountdowns(): () => void {
  const w = window as unknown as ImportedTimers
  const roots = Array.from(document.querySelectorAll<HTMLElement>('.lb-custom[data-lb-imported-countdown-date]'))
  if (w.__lbImportedCountdownTimer) {
    window.clearInterval(w.__lbImportedCountdownTimer)
    w.__lbImportedCountdownTimer = null
  }
  w.__lbImportedCountdownObservers?.forEach((observer) => observer.disconnect())
  w.__lbImportedCountdownObservers = []
  if (!roots.length) return () => {}

  const tick = () => {
    const now = Date.now()
    roots.forEach((root) => {
      const target = new Date(root.getAttribute('data-lb-imported-countdown-date') || '').getTime()
      if (Number.isNaN(target)) return
      const diff = Math.max(0, target - now)
      const total = Math.floor(diff / 1000)
      const parts: Record<string, number> = {
        days: Math.floor(total / 86400),
        hours: Math.floor((total % 86400) / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60,
      }
      Object.keys(parts).forEach((key) => {
        const node = numberNode(findSlot(root, key))
        if (node) {
          const next = pad(parts[key])
          if (node.textContent !== next) node.textContent = next
        }
      })
      root.classList.toggle('is-done', diff <= 0)
    })
  }

  tick()
  w.__lbImportedCountdownTimer = window.setInterval(tick, 1000)
  if (window.MutationObserver) {
    roots.forEach((root) => {
      const observer = new MutationObserver(() => tick())
      observer.observe(root, { subtree: true, childList: true, characterData: true })
      w.__lbImportedCountdownObservers!.push(observer)
    })
  }
  return () => {
    if (w.__lbImportedCountdownTimer) window.clearInterval(w.__lbImportedCountdownTimer)
    w.__lbImportedCountdownTimer = null
    w.__lbImportedCountdownObservers?.forEach((observer) => observer.disconnect())
    w.__lbImportedCountdownObservers = []
  }
}

// ---------------------------------------------------------------- runtime القالب المستورد
interface RuntimeItem {
  src?: string
  code?: string
  type?: string
}

declare global {
  interface Window {
    __lbTemplateRuntimeReady?: Promise<void>
  }
}

/**
 * سكربتات القالب المستورد بتتنفّذ بالترتيب واحد ورا التاني (الـpreload في
 * ‎<head>‎ بينزّلهم بالتوازي). ملف خارجي بنستناه لحد ‎load‎/‎error‎ أو ٤٫٥ ثانية.
 */
export function loadTemplateRuntime(entries: RuntimeItem[]): Promise<void> {
  const run = (item: RuntimeItem) =>
    new Promise<void>((resolve) => {
      const script = document.createElement('script')
      script.setAttribute('data-lb-template-runtime', '')
      if (item.type) script.type = item.type
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      if (item.src) {
        script.src = item.src
        script.onload = finish
        script.onerror = finish
        window.setTimeout(finish, 4500)
      } else {
        script.text = item.code || ''
      }
      ;(document.body || document.documentElement).appendChild(script)
      if (!item.src) finish()
    })
  let chain: Promise<void> = Promise.resolve()
  entries.forEach((item) => {
    chain = chain.then(() => run(item))
  })
  window.__lbTemplateRuntimeReady = chain
  return chain
}

/**
 * تطبيقات Vite/React المستوردة بتستخدم BrowserRouter؛ رابط المعاينة المتداخل
 * يبدو لها مساراً غير معروف فتظهر 404. بنعرض التطبيق على الجذر مؤقتاً أثناء
 * الإقلاع ثم نعيد عنوان المعاينة من غير إطلاق popstate.
 */
export function installSpaBridge() {
  const original = location.pathname + location.search + location.hash
  if (!original || original === '/') return
  const internal = '/' + location.search + location.hash
  history.replaceState(history.state, document.title, internal)
  const restore = () => {
    window.setTimeout(() => history.replaceState(history.state, document.title, original), 300)
  }
  if (document.readyState === 'complete') restore()
  else window.addEventListener('load', restore, { once: true })
}
