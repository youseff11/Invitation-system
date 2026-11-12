import { describe, expect, it } from 'vitest'

import { block } from './fixtures'
import { introContinuationId } from './introCont'
import type { IntroData } from './types'

const intro = (video = '/media-video/i.mp4') => ({ video }) as IntroData

describe('introContinuationId', () => {
  it('picks the first block when it is an autoplay file video after a video intro', () => {
    const v = block('video', { url: '/media/a.mp4', autoplay: true })
    expect(introContinuationId(intro(), [v, block('text', {})])).toBe(v.id)
  })

  it('skips hidden blocks when looking for the first one', () => {
    const hidden = { ...block('text', {}), hidden: true }
    const v = block('video', { url: '/media/a.mp4', autoplay: true })
    expect(introContinuationId(intro(), [hidden, v])).toBe(v.id)
  })

  it('is empty without a video intro', () => {
    const v = block('video', { url: '/media/a.mp4', autoplay: true })
    expect(introContinuationId(null, [v])).toBe('')
    expect(introContinuationId(intro(''), [v])).toBe('')
  })

  it('is empty when the video is not first, not autoplay, embedded, or under a heading', () => {
    const ok = { url: '/media/a.mp4', autoplay: true }
    expect(introContinuationId(intro(), [block('text', {}), block('video', ok)])).toBe('')
    expect(introContinuationId(intro(), [block('video', { ...ok, autoplay: false })])).toBe('')
    expect(introContinuationId(intro(), [block('video', { ...ok, url: 'https://youtu.be/abcdefg' })])).toBe('')
    expect(introContinuationId(intro(), [block('video', { ...ok, heading: 'فيلمنا' })])).toBe('')
  })
})
