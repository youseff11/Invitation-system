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

  it('replays a finished video when the guest taps it', async () => {
    const { container } = renderVideo({ loop: false })
    const v = container.querySelector('video')!
    see(v, true)
    await finish(v)
    const before = play.mock.calls.length
    fireEvent.click(container.querySelector('[data-video]')!)
    expect(play.mock.calls.length).toBeGreaterThan(before)
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
