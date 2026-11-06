/**
 * لوحة تشخيص الفيديو — بتشتغل بس لو الرابط فيه ‎?lbdebug=1‎.
 *
 * الهدف: نعرف من على الآيفون نفسه الفيديو وقف فين (اتطلب؟ اتحمّل؟ ‎play()‎
 * اترفض؟ شغّال ومستخبّي؟) من غير Mac ولا Web Inspector. بتسجّل أحداث كل
 * ‎<video>‎ ونتيجة كل ‎play()‎ وأحداث الافتتاحية واللمسات، وبتعرض حالة كل فيديو
 * لحظة بلحظة. زرار «نسخ» بيحط السجل كله في الحافظة عشان يتبعت.
 */

const MEDIA_EVENTS = [
  'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough',
  'play', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'abort',
  'emptied', 'error', 'ended', 'seeking', 'seeked',
]
const NET = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE']
const READY = ['NOTHING', 'METADATA', 'CURRENT', 'FUTURE', 'ENOUGH']
const ERR = ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED']

const t0 = performance.now()
const lines: string[] = []
const ids = new WeakMap<HTMLMediaElement, string>()
const watched = new WeakSet<HTMLMediaElement>()
let seq = 0
let logBox: HTMLElement | null = null
let stateBox: HTMLElement | null = null

const stamp = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(6, ' ')

function short(src: string): string {
  const clean = src.split('?')[0]
  const name = clean.split('/').pop() || clean
  const where = clean.startsWith('/media-video/') || clean.includes('/media-video/') ? 'mv' : clean.includes('/media/') ? 'MEDIA' : 'ext'
  return `${where}:${name.slice(-22)}`
}

function idOf(v: HTMLMediaElement): string {
  let id = ids.get(v)
  if (!id) {
    const kind = v.closest('.lb-intro') ? 'intro' : v.closest('.lb-video') ? 'block' : v.tagName === 'AUDIO' ? 'audio' : 'other'
    id = `${kind}#${++seq}`
    ids.set(v, id)
  }
  return id
}

function log(msg: string) {
  const line = `${stamp()} ${msg}`
  lines.push(line)
  if (lines.length > 400) lines.shift()
  if (logBox) {
    const row = document.createElement('div')
    row.textContent = line
    logBox.appendChild(row)
    while (logBox.childNodes.length > 120) logBox.removeChild(logBox.firstChild!)
    logBox.scrollTop = logBox.scrollHeight
  }
}

function buffered(v: HTMLMediaElement): string {
  try {
    const b = v.buffered
    return b.length ? `${b.end(b.length - 1).toFixed(1)}s` : '0'
  } catch {
    return '?'
  }
}

function describe(v: HTMLMediaElement): string {
  const cs = getComputedStyle(v)
  const r = v.getBoundingClientRect()
  const err = v.error ? ` ERR=${ERR[v.error.code] || v.error.code}${v.error.message ? `(${v.error.message})` : ''}` : ''
  return (
    `${idOf(v)} ${short(v.currentSrc || v.src)} ` +
    `rs=${READY[v.readyState]} ns=${NET[v.networkState]} ` +
    `${v.paused ? 'PAUSED' : 'PLAYING'} t=${v.currentTime.toFixed(2)}/${Number.isFinite(v.duration) ? v.duration.toFixed(1) : '?'} ` +
    `buf=${buffered(v)} muted=${v.muted ? 1 : 0} ` +
    `op=${cs.opacity} vis=${cs.visibility} disp=${cs.display} live=${v.getAttribute('data-live') ?? '-'} ` +
    `box=${Math.round(r.width)}x${Math.round(r.height)} ` +
    `${v instanceof HTMLVideoElement ? `vid=${v.videoWidth}x${v.videoHeight}` : ''}${err}`
  )
}

function watchMedia(v: HTMLMediaElement) {
  if (watched.has(v)) return
  watched.add(v)
  const id = idOf(v)
  log(`+ ${id} src=${v.getAttribute('src') || v.currentSrc} preload=${v.preload} autoplay=${v.autoplay ? 1 : 0} playsinline=${v.hasAttribute('playsinline') ? 1 : 0}`)
  MEDIA_EVENTS.forEach((ev) => {
    v.addEventListener(ev, () => {
      if (ev === 'error') log(`! ${describe(v)}`)
      else log(`${id} ${ev} rs=${READY[v.readyState]} t=${v.currentTime.toFixed(2)} buf=${buffered(v)}`)
    })
  })
  let lastTick = 0
  v.addEventListener('timeupdate', () => {
    const now = performance.now()
    if (now - lastTick < 1000) return
    lastTick = now
    log(`${id} timeupdate t=${v.currentTime.toFixed(2)}`)
  })
}

function scan(root: ParentNode = document) {
  root.querySelectorAll('video, audio').forEach((n) => watchMedia(n as HTMLMediaElement))
}

function patchPlay() {
  const proto = HTMLMediaElement.prototype
  const original = proto.play
  proto.play = function patchedPlay(this: HTMLMediaElement) {
    watchMedia(this)
    const id = idOf(this)
    const gesture = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
    log(`> ${id}.play() muted=${this.muted ? 1 : 0} rs=${READY[this.readyState]} gesture=${gesture === undefined ? '?' : gesture ? 1 : 0}`)
    let result: Promise<void>
    try {
      result = original.call(this)
    } catch (e) {
      log(`x ${id}.play() threw ${(e as Error).name}: ${(e as Error).message}`)
      throw e
    }
    if (result && typeof result.then === 'function') {
      result.then(
        () => log(`ok ${id}.play() resolved`),
        (e: Error) => log(`x ${id}.play() REJECTED ${e?.name}: ${e?.message}`),
      )
    }
    return result
  }
  const pause = proto.pause
  proto.pause = function patchedPause(this: HTMLMediaElement) {
    log(`> ${idOf(this)}.pause()`)
    return pause.call(this)
  }
  const load = proto.load
  proto.load = function patchedLoad(this: HTMLMediaElement) {
    log(`> ${idOf(this)}.load()`)
    return load.call(this)
  }
}

function panel() {
  const wrap = document.createElement('div')
  wrap.setAttribute('data-lb-debug', '')
  wrap.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:46vh;display:flex;flex-direction:column;' +
    'background:rgba(0,0,0,.86);color:#9f9;font:10px/1.35 ui-monospace,Menlo,monospace;direction:ltr;text-align:left;' +
    'pointer-events:auto;-webkit-user-select:text;user-select:text'
  const bar = document.createElement('div')
  bar.style.cssText = 'display:flex;gap:6px;padding:4px;background:#222;align-items:center'
  const title = document.createElement('b')
  title.textContent = 'lbdebug'
  title.style.cssText = 'color:#fff;flex:1'
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = 'font:12px sans-serif;padding:4px 10px;border-radius:6px;border:0;background:#4a4;color:#fff'
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      fn()
    }, true)
    return b
  }
  let small = false
  bar.append(
    title,
    btn('نسخ', () => {
      const text = [`UA: ${navigator.userAgent}`, `URL: ${location.href}`, '--- state', stateBox?.innerText || '', '--- log', ...lines].join('\n')
      const done = () => log('copied ✓')
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text))
      else fallbackCopy(text)
    }),
    btn('تصغير', () => {
      small = !small
      body.style.display = small ? 'none' : 'flex'
    }),
  )
  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;min-height:0;overflow:hidden'
  stateBox = document.createElement('div')
  stateBox.style.cssText = 'padding:4px;color:#ff6;border-bottom:1px solid #444;white-space:pre-wrap;word-break:break-all'
  logBox = document.createElement('div')
  logBox.style.cssText = 'padding:4px;overflow:auto;white-space:pre-wrap;word-break:break-all;flex:1;min-height:80px'
  body.append(stateBox, logBox)
  wrap.append(bar, body)
  // اللمسات على اللوحة ماتوصلش للافتتاحية ولا للدعوة
  ;['click', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((ev) =>
    wrap.addEventListener(ev, (e) => e.stopPropagation()),
  )
  document.body.appendChild(wrap)
  lines.forEach((line) => {
    const row = document.createElement('div')
    row.textContent = line
    logBox!.appendChild(row)
  })
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    log('copied ✓ (fallback)')
  } catch {
    log('copy failed — select the text manually')
  }
  ta.remove()
}

function refreshState() {
  if (!stateBox) return
  const media = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'))
  const intro = document.querySelector('.lb-intro')
  stateBox.textContent =
    `intro=${intro ? intro.className.replace(/\s+/g, '.') : 'gone'} hidden=${document.hidden ? 1 : 0}\n` +
    (media.length ? media.map(describe).join('\n') : 'no media')
}

export function startDebug() {
  log(`UA ${navigator.userAgent}`)
  log(`URL ${location.pathname}`)
  patchPlay()
  window.addEventListener('error', (e) => log(`JS ERROR ${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => log(`REJECTION ${String((e.reason as Error)?.message ?? e.reason)}`))
  ;['lb:intro-play', 'lb:intro-open'].forEach((ev) => document.addEventListener(ev, () => log(`* ${ev}`)))
  document.addEventListener('visibilitychange', () => log(`* visibility ${document.visibilityState}`))
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as Element | null
      if (!el || el.closest('[data-lb-debug]')) return
      const tag = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
      log(`* click ${tag}`)
    },
    true,
  )
  const start = () => {
    panel()
    scan()
    new MutationObserver((records) => {
      records.forEach((r) => r.addedNodes.forEach((n) => {
        if (n instanceof HTMLMediaElement) watchMedia(n)
        else if (n instanceof Element) scan(n)
      }))
    }).observe(document.body, { childList: true, subtree: true })
    refreshState()
    window.setInterval(refreshState, 500)
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
