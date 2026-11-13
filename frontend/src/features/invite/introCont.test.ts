import { describe, expect, it } from 'vitest'

import { block } from './fixtures'
import { CONT_REF_H, contFit, introContinuationId } from './introCont'
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

describe('contFit', () => {
  // نقطة من الكود (إزاحة ‎y‎ بوحدات الكود من بدايته) بالنسبة لصورة الفيديو على جهاز
  const spot = (w: number, h: number, y: number) => {
    const { k, shift } = contFit(w, h, 720, 1280)
    const scale = Math.max(w / 720, h / 1280)
    const top = (h - 1280 * scale) / 2
    return (h + (shift + y) * k - top) / (1280 * scale)
  }

  it('leaves the editor frame (390×844) untouched', () => {
    expect(contFit(390, 844, 720, 1280)).toEqual({ k: 1, shift: 0 })
  })

  it('keeps the code on the same spot of the picture on any phone', () => {
    const ref = spot(390, CONT_REF_H, -700)
    for (const [w, h] of [[390, 664], [412, 800], [375, 667], [430, 932]]) {
      expect(spot(w, h, -700)).toBeCloseTo(ref, 3)
    }
  })

  it('scales the code with the picture, not with the width alone', () => {
    // سفاري على آيفون: نفس عرض المحرر بس أقصر — الصورة أصغر فالكلام أصغر
    expect(contFit(390, 664, 720, 1280).k).toBeCloseTo(0.8219, 3)
  })

  it('ignores missing sizes', () => {
    expect(contFit(0, 844, 720, 1280)).toEqual({ k: 1, shift: 0 })
    expect(contFit(390, 844, 0, 0)).toEqual({ k: 1, shift: 0 })
  })
})
