import { describe, expect, it } from 'vitest'

import { CONTENT, moveLayer, stackOrder } from './overlayStack'

const items = [{ kind: 'image' }, { kind: 'text' }, { kind: 'button' }]

describe('stackOrder', () => {
  it('عناصر قديمة من غير z: بترتيب الإضافة وكلها فوق المحتوى', () => {
    expect(stackOrder(items)).toEqual([CONTENT, 0, 1, 2])
  })

  it('اللي behind تحت المحتوى، وz بيرتّب جوّه كل جهة', () => {
    const list = [{ behind: true, z: 1 }, { z: 5 }, { behind: true, z: 0 }, { z: 2 }]
    expect(stackOrder(list)).toEqual([2, 0, CONTENT, 3, 1])
  })
})

describe('moveLayer', () => {
  it('«للأمام» بيبدّل مع اللي فوقه ويكتب z لكل المتأثرين بس', () => {
    const next = moveLayer(items, 0, 'up')
    expect(next).not.toBeNull()
    expect(stackOrder(next!)).toEqual([CONTENT, 1, 0, 2])
    expect(next![1]).toBe(items[1])
  })

  it('«للخلف» على أول عنصر فوق المحتوى بينزّله تحت المحتوى (الصورة ورا الكلام)', () => {
    const next = moveLayer(items, 0, 'down')
    expect(next![0]).toMatchObject({ behind: true })
    expect(stackOrder(next!)).toEqual([0, CONTENT, 1, 2])
  })

  it('«أمام الكل» و«خلف الكل»', () => {
    expect(stackOrder(moveLayer(items, 0, 'front')!)).toEqual([CONTENT, 1, 2, 0])
    expect(stackOrder(moveLayer(items, 2, 'back')!)).toEqual([2, CONTENT, 0, 1])
  })

  it('مفيش حاجة تتغيّر = null', () => {
    expect(moveLayer(items, 2, 'up')).toBeNull()
    expect(moveLayer(items, 2, 'front')).toBeNull()
    expect(moveLayer(items, 9, 'up')).toBeNull()
  })

  it('رجوع عنصر من تحت المحتوى لفوقه', () => {
    const down = moveLayer(items, 0, 'down')!
    const up = moveLayer(down, 0, 'up')!
    expect(stackOrder(up)).toEqual([CONTENT, 0, 1, 2])
    expect(up[0]).toMatchObject({ behind: false })
  })
})
