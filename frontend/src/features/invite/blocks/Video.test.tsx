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
})
