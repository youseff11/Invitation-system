import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { block } from '@/features/invite/fixtures'
import type { BlockData } from '@/features/invite/types'

import type { FromFrame, PreviewPayload } from '../types'
import { clearDragVars, dragOffset, installInteractions, slotUnit, swapCandidate, swapImages } from './interactions'

describe('px slots', () => {
  it('uses pixels for imported elements and cqw for everything else', () => {
    expect(['el-3', 'ce-1', 'code'].map(slotUnit)).toEqual(['px', 'px', 'px'])
    expect(['kicker', 'countdown'].map(slotUnit)).toEqual(['cqw', 'cqw'])
  })

  it('snaps to zero within 4px (not 1.2) when asked for the pixel threshold', () => {
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 3, y: 30 }, 1, false, 4)).toMatchObject({ dx: 0, snapX: true, dy: 30, snapY: false })
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 3, y: 30 }, 1)).toMatchObject({ dx: 3, snapX: false })
  })
})

describe('swapImages', () => {
  it('swaps src and srcset together and drops an attribute the other image did not have', () => {
    document.body.innerHTML = '<img id="a" src="1.png" srcset="1x.png 2x"><img id="b" src="2.png">'
    const [a, b] = [document.getElementById('a')!, document.getElementById('b')!]
    swapImages(a, b)
    expect([a.getAttribute('src'), a.getAttribute('srcset')]).toEqual(['2.png', null])
    expect([b.getAttribute('src'), b.getAttribute('srcset')]).toEqual(['1.png', '1x.png 2x'])
  })
})

describe('dragging inside an imported section', () => {
  let sent: FromFrame[]
  let payload: PreviewPayload
  let stop: () => void
  const imp = (extra: Partial<BlockData> = {}) =>
    block('custom_html', {}, { id: 'imp', attrs: { id: 'imp', className: 'lb', style: '' }, ...extra })

  const mouse = (type: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  beforeEach(() => {
    sent = []
    document.body.innerHTML =
      '<div class="lb-stage"><section data-block="imp" data-block-type="custom_html"><div class="lb-custom">' +
      '<h1 data-move="el-1" data-lb-text="1">ليلى</h1>' +
      '<img id="pa" data-move="el-2" src="a.png"><img id="pb" data-move="el-3" src="b.png">' +
      '</div><div class="lb-extra-html"><p data-move="ce-1">c</p></div></section></div>'
    document.querySelector('.lb-stage')!.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect
    payload = { lang: 'ar', baseLang: 'ar', blocks: [imp({ layout: { 'el-1': { dx: 10, dy: 0 } } })] } as unknown as PreviewPayload
    stop = installInteractions({ payload: () => payload, send: (m) => sent.push(m) })
  })
  afterEach(() => {
    stop()
    document.body.innerHTML = ''
  })

  const h1 = () => document.querySelector<HTMLElement>('[data-move="el-1"]')!

  it('drags in pixels (not cqw), continuing from the saved offset', () => {
    h1().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    h1().dispatchEvent(mouse('pointermove', { clientX: 40, clientY: 25 }))
    expect(h1().style.getPropertyValue('--dx')).toBe('50px') // 10 المحفوظة + 40
    expect(h1().style.getPropertyValue('--dy')).toBe('25px')
    expect(document.querySelector('.lb-drag-badge')!.textContent).toBe('50.0px , 25.0px')
    h1().dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: 'imp', slot: 'el-1', dx: 50, dy: 25 })
  })

  it('does not turn a text unit into an editable one after dragging it (plaintext-only forces pre-wrap and blows up the layout)', () => {
    expect(h1().hasAttribute('contenteditable')).toBe(false)
    h1().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    h1().dispatchEvent(mouse('pointermove', { clientX: 40, clientY: 25 }))
    h1().dispatchEvent(mouse('pointerup'))
    expect(h1().hasAttribute('contenteditable')).toBe(false)
    expect(h1().classList.contains('lb-dragging')).toBe(false)
  })

  it('keeps the dropped offset on the element until a render carries it (no jump back to the old place)', () => {
    h1().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    h1().dispatchEvent(mouse('pointermove', { clientX: 40, clientY: 25 }))
    h1().dispatchEvent(mouse('pointerup'))
    // رسمة قديمة (لسه فيها الإزاحة القديمة ١٠): الإزاحة المؤقتة تفضل
    clearDragVars(document, payload.blocks)
    expect(h1().style.getPropertyValue('--dx')).toBe('50px')
    // الرسمة اللي فيها الإزاحة الجديدة: تتشال
    clearDragVars(document, [imp({ layout: { 'el-1': { dx: 50, dy: 25 } } })])
    expect(h1().style.getPropertyValue('--dx')).toBe('')
    expect(h1().style.getPropertyValue('--dy')).toBe('')
  })

  it('does not start a drag from a numbered text that is open for typing', () => {
    h1().setAttribute('tabindex', '0')
    h1().setAttribute('contenteditable', 'plaintext-only')
    h1().focus()
    h1().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    h1().dispatchEvent(mouse('pointermove', { clientX: 90, clientY: 0 }))
    h1().dispatchEvent(mouse('pointerup'))
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
  })

  it('drags an advanced-code element (ce-N) in pixels too, and the box itself ("code")', () => {
    const node = document.querySelector('.lb-extra-html [data-move="ce-1"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 90, clientY: 0 }))
    node.dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: 'imp', slot: 'ce-1', dx: 90, dy: 0 })

    sent.length = 0
    const box = document.querySelector<HTMLElement>('.lb-extra-html')!
    box.setAttribute('data-move', 'code')
    box.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    box.dispatchEvent(mouse('pointermove', { clientX: 20, clientY: 10 }))
    box.dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: 'imp', slot: 'code', dx: 20, dy: 10 })
  })

  it('still leaves the intro alone (S6)', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="lb-intro"><p data-move="ce-9">x</p></div>')
    const node = document.querySelector('.lb-intro [data-move="ce-9"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 90, clientY: 0 }))
    node.dispatchEvent(mouse('pointerup'))
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
  })

  describe('dropping an image on another image', () => {
    const pa = () => document.getElementById('pa')!
    const pb = () => document.getElementById('pb')!
    const stack = (nodes: Element[]) => {
      document.elementsFromPoint = () => nodes
    }
    beforeEach(() => {
      pb().getBoundingClientRect = () => ({ left: 100, right: 200, top: 100, bottom: 200, width: 100, height: 100 }) as DOMRect
    })
    afterEach(() => {
      // @ts-expect-error — jsdom ما عندوش elementsFromPoint؛ نرجّعه زي ما كان
      delete document.elementsFromPoint
    })

    it('marks the target only when the pointer is inside its central 60%', () => {
      stack([pa(), pb()])
      expect(swapCandidate(pa(), 150, 150)).toBe(pb())
      expect(swapCandidate(pa(), 105, 150)).toBeNull() // على الحرف
      expect(swapCandidate(pb(), 150, 150)).toBeNull() // الهدف لازم يكون صورة تانية
    })

    it('swaps the two images instead of moving, and saves the html', () => {
      stack([pa(), pb()])
      pa().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
      pa().dispatchEvent(mouse('pointermove', { clientX: 150, clientY: 150 }))
      expect(pb().classList.contains('lb-el-swap')).toBe(true)
      pa().dispatchEvent(mouse('pointerup'))
      expect(pb().classList.contains('lb-el-swap')).toBe(false)
      expect([pa().getAttribute('src'), pb().getAttribute('src')]).toEqual(['b.png', 'a.png'])
      expect(pa().style.getPropertyValue('--dx')).toBe('') // رجعت لمكانها
      expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
      const html = sent.find((m) => m.type === 'lb-editor:html') as { id: string; value: string; silent: boolean }
      expect(html).toMatchObject({ id: 'imp', silent: false })
      expect(html.value).toMatch(/id="pa"[^>]*src="b\.png"/)
    })

    it('Escape cancels the swap', () => {
      stack([pa(), pb()])
      pa().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
      pa().dispatchEvent(mouse('pointermove', { clientX: 150, clientY: 150 }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect([pa().getAttribute('src'), pb().getAttribute('src')]).toEqual(['a.png', 'b.png'])
      expect(pb().classList.contains('lb-el-swap')).toBe(false)
      expect(sent.some((m) => m.type === 'lb-editor:html')).toBe(false)
    })
  })
})
