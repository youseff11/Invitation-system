import { describe, expect, it } from 'vitest'

import { applyRatio, clampBox, dragBox, initialBox, MIN_BOX, toRatios, type Box } from './cropMath'

// الصورة 300×200 بتبدأ من (50, 20) جوّه المسرح
const bounds: Box = { x: 50, y: 20, w: 300, h: 200 }

describe('cropMath', () => {
  it('starts with an 80% box centred on the image', () => {
    expect(initialBox(bounds)).toEqual({ x: 80, y: 40, w: 240, h: 160 })
  })

  it('clamps the box inside the image and above the minimum size', () => {
    expect(clampBox({ x: 0, y: 0, w: 100, h: 100 }, bounds)).toMatchObject({ x: 50, y: 20 })
    expect(clampBox({ x: 340, y: 210, w: 100, h: 100 }, bounds)).toEqual({ x: 250, y: 120, w: 100, h: 100 })
    expect(clampBox({ x: 100, y: 100, w: 1, h: 1 }, bounds)).toMatchObject({ w: MIN_BOX, h: MIN_BOX })
    expect(clampBox({ x: 60, y: 30, w: 999, h: 999 }, bounds)).toEqual({ x: 50, y: 20, w: 300, h: 200 })
  })

  it('moves the whole box when no handle is grabbed, stopping at the edges', () => {
    const start: Box = { x: 80, y: 40, w: 100, h: 100 }
    expect(dragBox(start, null, 20, 10, 0, bounds)).toEqual({ x: 100, y: 50, w: 100, h: 100 })
    expect(dragBox(start, null, -500, 500, 0, bounds)).toEqual({ x: 50, y: 120, w: 100, h: 100 })
  })

  it('resizes from every corner (physical directions)', () => {
    const start: Box = { x: 100, y: 60, w: 100, h: 80 }
    expect(dragBox(start, 'se', 20, 10, 0, bounds)).toEqual({ x: 100, y: 60, w: 120, h: 90 })
    expect(dragBox(start, 'nw', 10, 10, 0, bounds)).toEqual({ x: 110, y: 70, w: 90, h: 70 })
    expect(dragBox(start, 'ne', 20, -10, 0, bounds)).toEqual({ x: 100, y: 50, w: 120, h: 90 })
    expect(dragBox(start, 'sw', -10, 20, 0, bounds)).toEqual({ x: 90, y: 60, w: 110, h: 100 })
  })

  it('keeps the aspect ratio while resizing and can re-apply a ratio', () => {
    const start: Box = { x: 100, y: 60, w: 100, h: 80 }
    expect(dragBox(start, 'se', 20, 0, 1, bounds)).toEqual({ x: 100, y: 60, w: 120, h: 120 })
    expect(applyRatio({ x: 80, y: 40, w: 240, h: 100 }, 16 / 9, bounds)).toEqual({ x: 80, y: 40, w: 240, h: 135 })
    // حر = من غير تغيير
    expect(applyRatio({ x: 80, y: 40, w: 240, h: 100 }, 0, bounds)).toEqual({ x: 80, y: 40, w: 240, h: 100 })
  })

  it('never grows past the image when the ratio is taller than the room left', () => {
    const box = applyRatio({ x: 80, y: 40, w: 240, h: 160 }, 1, bounds)
    expect(box.h).toBeLessThanOrEqual(bounds.h)
    expect(box.y + box.h).toBeLessThanOrEqual(bounds.y + bounds.h)
  })

  it('converts the box to ratios of the image (what the server crops with)', () => {
    expect(toRatios({ x: 80, y: 40, w: 240, h: 160 }, bounds)).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(toRatios({ x: 50, y: 20, w: 300, h: 200 }, bounds)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})
