import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteContext } from '../context'
import { block } from '../fixtures'
import { Video } from './Video'

type IoCallback = (entries: { isIntersecting: boolean; target: Element }[]) => void

let ioCallback: IoCallback | null = null
let play: ReturnType<typeof vi.fn>

class FakeObserver {
  constructor(cb: IoCallback) {
    ioCallback = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderVideo(props: Record<string, unknown>, hasIntro = false) {
  return render(
    <InviteContext.Provider value={{ lang: 'ar', t: (k) => k, maxWidth: 0, demo: true, hasIntro }}>
      <Video block={block('video', { url: '/media/a.mp4', autoplay: true, ...props })} />
    </InviteContext.Provider>,
  )
}

const see = (v: HTMLVideoElement, on: boolean) =>
  act(() => ioCallback?.([{ isIntersecting: on, target: v }]))

/** نهاية التشغيل زي المتصفح: ‎pause‎ قبل ‎ended‎ — و‎v.ended‎ ممكن يفضل ‎false‎ على الموبايل. */
async function finish(v: HTMLVideoElement) {
  Object.defineProperty(v, 'paused', { configurable: true, get: () => true })
  Object.defineProperty(v, 'duration', { configurable: true, get: () => 6 })
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => 5.9, set: () => {} })
  // المتصفح بيسجّل اللي اتعرض في ‎played‎
  Object.defineProperty(v, 'played', { configurable: true, get: () => ({ length: 1 }) })
  fireEvent(v, new Event('pause'))
  fireEvent(v, new Event('ended'))
  await act(() => new Promise((r) => setTimeout(r, 5)))
}

describe('Video block', () => {
  beforeEach(() => {
    ioCallback = null
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    play = vi.fn(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('does not replay a non-looping video after it ends', async () => {
    const { container } = renderVideo({ loop: false })
    const v = container.querySelector('video')!
    see(v, true)
    expect(play).toHaveBeenCalledTimes(1)

    await finish(v)
    see(v, false)
    see(v, true) // القسم رجع للشاشة
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('does not replay a finished non-looping video when the guest taps it', async () => {
    // «تكرار» مقفول من المحرر = مرة واحدة بس، حتى بالضغط
    const { container } = renderVideo({ loop: false })
    const v = container.querySelector('video')!
    see(v, true)
    await finish(v)
    const before = play.mock.calls.length
    fireEvent.click(container.querySelector('[data-video]')!)
    expect(play.mock.calls.length).toBe(before)
  })

  it('a tap still starts a video that has not played yet', () => {
    // من غير تشغيل تلقائي الضغطة هي الطريقة الوحيدة (مفيش شريط تحكم)
    const { container } = renderVideo({ loop: false, autoplay: false })
    const before = play.mock.calls.length
    fireEvent.click(container.querySelector('[data-video]')!)
    expect(play.mock.calls.length).toBe(before + 1)
  })

  it('holds the autoplay video behind an open intro, also on template previews (demo)', () => {
    const intro = document.createElement('div')
    intro.className = 'lb-intro'
    document.body.appendChild(intro)
    const { container } = renderVideo({ loop: false }, true)
    const v = container.querySelector('video')!
    expect(v.autoplay).toBe(false)
    expect(ioCallback).toBeNull() // المراقب لسه مااشتغلش
    expect(play).not.toHaveBeenCalled()

    act(() => {
      intro.classList.add('is-open')
      document.dispatchEvent(new CustomEvent('lb:intro-open'))
    })
    expect(ioCallback).not.toBeNull()
    // ‎lb:intro-open‎ كمان بيفكّ قفل الوسائط (تشغيل وإيقاف) — العدّ بعده
    const before = play.mock.calls.length
    see(v, true)
    expect(play.mock.calls.length).toBe(before + 1)
  })

  it('starts the on-screen video the moment the intro ends, without waiting for the observer', () => {
    const intro = document.createElement('div')
    intro.className = 'lb-intro'
    document.body.appendChild(intro)
    const { container } = renderVideo({ loop: false }, true)
    const v = container.querySelector('video')!
    // الفيديو أول قسم: مالي أعلى الشاشة ورا الافتتاحية
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue(
      { top: 0, bottom: 693, height: 693, left: 0, right: 390, width: 390, x: 0, y: 0 } as DOMRect,
    )
    const pending = play.mock.calls.length
    act(() => {
      intro.classList.add('is-open')
      document.dispatchEvent(new CustomEvent('lb:intro-open'))
    })
    // اشتغل جوّه الحدث نفسه — من غير أي نداء للمراقب: فكّ القفل (تشغيل
    // وإيقاف) + التشغيل الفعلي. اللي تحت الشاشة بياخد فكّ القفل بس.
    expect(play.mock.calls.length).toBe(pending + 2)
    expect(play.mock.contexts.filter((c) => c === v)).toHaveLength(2)
  })

  it('keeps a below-the-fold video waiting for the observer after the intro', () => {
    const intro = document.createElement('div')
    intro.className = 'lb-intro'
    document.body.appendChild(intro)
    const { container } = renderVideo({ loop: false }, true)
    const v = container.querySelector('video')!
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue(
      { top: 2000, bottom: 2600, height: 600, left: 0, right: 390, width: 390, x: 0, y: 2000 } as DOMRect,
    )
    act(() => {
      intro.classList.add('is-open')
      document.dispatchEvent(new CustomEvent('lb:intro-open'))
    })
    // فكّ قفل الوسائط بس (بيتوقف على طول) — مش تشغيل
    expect(play.mock.contexts.filter((c) => c === v)).toHaveLength(1)
  })

  it('plays a tall video that fills the screen even though under 35% of it is visible', () => {
    const { container } = renderVideo({ loop: false })
    const v = container.querySelector('video')!
    const before = play.mock.calls.length
    // ‎9:16‎ بعرض ديسكتوب: ‎3029px‎ طول، والشاشة ‎825px‎ = ‎27%‎ بس منه
    act(() =>
      (ioCallback as unknown as (e: Partial<IntersectionObserverEntry>[]) => void)([
        {
          isIntersecting: true,
          target: v,
          intersectionRatio: 0.27,
          intersectionRect: { height: 825 } as DOMRectReadOnly,
          boundingClientRect: { height: 3029 } as DOMRectReadOnly,
          rootBounds: { height: 825 } as DOMRectReadOnly,
        },
      ]),
    )
    expect(play.mock.calls.length).toBe(before + 1)
  })

  it('fills the screen like the intro when it continues the intro video', () => {
    const b = block('video', { url: '/media/a.mp4', autoplay: true })
    const { container } = render(
      <InviteContext.Provider
        value={{ lang: 'ar', t: (k) => k, maxWidth: 0, demo: true, hasIntro: true, introContId: b.id }}
      >
        <Video block={b} />
      </InviteContext.Provider>,
    )
    const css = container.querySelector('style[data-intro-cont]')?.textContent ?? ''
    // بيكسب ارتفاع القسم المتخزّن (‎#id{…!important}‎) بخصوصية أعلى
    expect(css).toContain(`html #${b.attrs.id}`)
    expect(css).toContain('height:100dvh!important')
    expect(css).toContain('object-fit:cover')
    // نفس مكان الافتتاحية: إزاحة الفيديو المتخزّنة مالهاش مكان هنا
    expect(css).toContain('[data-move="video"]{transform:none!important}')
    // كود القسم بيتكبّر ويتزاح مع صورة الفيديو
    expect(css).toContain('zoom:var(--lb-cont-fit,1)!important')
    expect(css).toContain('top:var(--lb-cont-shift,0px)')
    const sec = container.querySelector<HTMLElement>('[data-block]')!
    expect(sec.style.getPropertyValue('--lb-cont-fit')).not.toBe('')
  })

  it('loads the intro-continuing video into memory and plays it from there', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => '1000' },
        blob: () => Promise.resolve(new Blob(['x'], { type: 'video/mp4' })),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v2'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const b = block('video', { url: '/media-video/v2.mp4', autoplay: true })
    const { container } = render(
      <InviteContext.Provider
        value={{ lang: 'ar', t: (k) => k, maxWidth: 0, demo: true, hasIntro: true, introContId: b.id }}
      >
        <Video block={b} />
      </InviteContext.Provider>,
    )
    const v = container.querySelector('video')!
    // مابيحمّلش نفس الملف من الشبكة كمان وهو بيتحمّل في الذاكرة
    expect(v.preload).toBe('metadata')
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledWith('/media/v2.mp4', expect.anything())
    expect(v.getAttribute('src')).toBe('blob:v2')
  })

  it('does not load ordinary videos into memory', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderVideo({ loop: false }, true)
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps its normal size when it does not continue the intro', () => {
    const { container } = renderVideo({ loop: false }, true)
    expect(container.querySelector('style[data-intro-cont]')).toBeNull()
  })

  it('does not start a video that only peeks into the screen', () => {
    const { container } = renderVideo({ loop: false })
    const v = container.querySelector('video')!
    const before = play.mock.calls.length
    act(() =>
      (ioCallback as unknown as (e: Partial<IntersectionObserverEntry>[]) => void)([
        {
          isIntersecting: true,
          target: v,
          intersectionRatio: 0.1,
          intersectionRect: { height: 60 } as DOMRectReadOnly,
          boundingClientRect: { height: 600 } as DOMRectReadOnly,
          rootBounds: { height: 825 } as DOMRectReadOnly,
        },
      ]),
    )
    expect(play.mock.calls.length).toBe(before)
  })
})
