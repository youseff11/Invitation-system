import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteContext } from './context'
import { intro } from './fixtures'
import { Intro } from './Intro'
import { makeT } from './strings'

function renderIntro(data = intro()) {
  return render(
    <InviteContext.Provider value={{ lang: 'ar', t: makeT('ar'), maxWidth: 760, demo: false, hasIntro: true }}>
      <Intro data={data} />
    </InviteContext.Provider>,
  )
}

describe('Intro', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.style.overflow = ''
  })
  afterEach(() => vi.useRealTimers())

  it('locks scrolling until the guest opens the invitation', () => {
    const opened = vi.fn()
    document.addEventListener('lb:intro-open', opened)
    const { container } = renderIntro()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(container.querySelector('[data-intro-open]')!)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.lb-intro')!.classList.contains('is-open')).toBe(true)
    expect(document.body.style.overflow).toBe('')
    // الافتتاحية بتتشال بعد انتهاء الانتقال
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('.lb-intro')).toBeNull()
    document.removeEventListener('lb:intro-open', opened)
  })

  it('any tap on the screen opens it, and the event is sent only once', () => {
    const opened = vi.fn()
    document.addEventListener('lb:intro-open', opened)
    const { container } = renderIntro()
    const root = container.querySelector('.lb-intro')!
    fireEvent.click(root)
    fireEvent.click(root)
    expect(opened).toHaveBeenCalledTimes(1)
    document.removeEventListener('lb:intro-open', opened)
  })

  it('opens by itself after the configured seconds', () => {
    const { container } = renderIntro(intro({ seconds: 3 }))
    expect(container.querySelector('.lb-intro')!.classList.contains('is-open')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(container.querySelector('.lb-intro')!.classList.contains('is-open')).toBe(true)
  })

  it('renders the guest greeting and the per-item styles', () => {
    const { container } = renderIntro(intro({ guestName: 'منى', itemStyles: { button: '--intro-item-x:3vw' } }))
    expect(container.querySelector('.lb-intro-name')!.textContent).toBe('أهلاً منى')
    expect((container.querySelector('[data-intro-open]') as HTMLElement).style.getPropertyValue('--intro-item-x')).toBe(
      '3vw',
    )
  })

  describe('video started by the intro code', () => {
    const knock = {
      css: '',
      html: '<div class="knock"></div>',
      js: 'var video = document.querySelector("video"); window.__knock = function () { video.play() }',
    }

    it('does not autoplay when the code decides when the video starts', () => {
      const play = vi.fn().mockResolvedValue(undefined)
      HTMLMediaElement.prototype.play = play
      HTMLMediaElement.prototype.pause = vi.fn()
      HTMLMediaElement.prototype.load = vi.fn()
      const { container } = renderIntro(intro({ video: '/v.mp4', audio: 'sound', code: knock }))
      const video = container.querySelector('video')!
      expect(video.hasAttribute('autoplay')).toBe(false)
      expect(play).not.toHaveBeenCalled()
      expect(container.querySelector('.lb-intro')!.classList.contains('is-video-blocked')).toBe(false)
    })

    it('still autoplays when the code never touches the video', () => {
      const play = vi.fn().mockResolvedValue(undefined)
      HTMLMediaElement.prototype.play = play
      HTMLMediaElement.prototype.pause = vi.fn()
      HTMLMediaElement.prototype.load = vi.fn()
      const sparkle = { css: '', html: '<i></i>', js: 'window.__pop = function () { new Audio("/pop.wav").play() }' }
      const { container } = renderIntro(intro({ video: '/v.mp4', code: sparkle }))
      expect(container.querySelector('video')!.hasAttribute('autoplay')).toBe(true)
      expect(play).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the cover as one plain image and reveals the video only once it plays', () => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()
    const { container } = renderIntro(intro({ video: '/v.mp4', poster: '/p.png', playMode: 'button' }))
    const video = container.querySelector('video')!
    // مصدر واحد للغلاف: مفيش poster ولا خلفية على الفيديو يتبدّلوا مع الضغط
    expect(container.querySelector('img.lb-intro-poster')!.getAttribute('src')).toBe('/p.png')
    expect(video.hasAttribute('poster')).toBe(false)
    expect(video.style.backgroundImage).toBe('')
    expect(video.getAttribute('data-live')).toBe('0')
    act(() => {
      fireEvent(video, new Event('playing'))
      vi.advanceTimersByTime(200)
    })
    expect(video.getAttribute('data-live')).toBe('1')
  })

  it('manual video mode waits for the play button and keeps the auto timer paused', () => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()
    const played = vi.fn()
    document.addEventListener('lb:intro-play', played)
    const { container } = renderIntro(intro({ video: '/v.mp4', playMode: 'button', seconds: 2 }))
    const root = container.querySelector('.lb-intro')!
    expect(root.classList.contains('is-awaiting-play')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(root.classList.contains('is-open')).toBe(false)
    fireEvent.click(container.querySelector('[data-intro-play]')!)
    expect(played).toHaveBeenCalledTimes(1)
    expect(root.classList.contains('is-awaiting-play')).toBe(false)
    expect(root.classList.contains('is-open')).toBe(false)
    document.removeEventListener('lb:intro-play', played)
  })
})
