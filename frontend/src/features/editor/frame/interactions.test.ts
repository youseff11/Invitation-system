import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { block } from '@/features/invite/fixtures'
import type { BlockData } from '@/features/invite/types'

import type { FromFrame, PreviewPayload } from '../types'
import { clearDragVars, dragOffset, installInteractions, isPxSlot, markEditable, patchText } from './interactions'

describe('dragOffset', () => {
  it('turns pixels into cqw using the stage unit, from the start offset', () => {
    expect(dragOffset({ dx0: 5, dy0: -2 }, { x: 100, y: 50 }, 10)).toEqual({ dx: 15, dy: 3, snapX: false, snapY: false })
  })

  it('Shift slows the move to a quarter, and tiny offsets snap to zero with a guide', () => {
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 100, y: 0 }, 10, true).dx).toBe(2.5)
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 8, y: 100 }, 10)).toMatchObject({ dx: 0, snapX: true, dy: 10, snapY: false })
  })

  it('rounds to two decimals and stays inside the layout limits', () => {
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 33.333, y: 0 }, 10).dx).toBe(3.33)
    expect(dragOffset({ dx0: 0, dy0: 0 }, { x: 1e9, y: -1e9 }, 1)).toMatchObject({ dx: 1000, dy: -1000 })
    expect(dragOffset({ dx0: 1, dy0: 1 }, { x: 5, y: 5 }, 0).dx).toBeGreaterThan(0) // unit 0 doesn't divide by zero
  })

  it('knows the pixel-based slots of imported sections', () => {
    expect(['el-12', 'ce-3', 'code'].every(isPxSlot)).toBe(true)
    expect(['kicker', 'name_one', 'countdown', ''].some(isPxSlot)).toBe(false)
  })
})

const section = (id: string, inner = '') =>
  `<section data-block="${id}" data-block-type="hero">${inner}</section>`

const blockData = (id: string, props: Record<string, unknown>, extra: Partial<BlockData> = {}) =>
  block('hero', props, { id, attrs: { id, className: 'lb', style: '' }, ...extra })

describe('markEditable / patchText', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens only the texts that exist in the section props, and not for locked sections', () => {
    document.body.innerHTML =
      section('a', '<p data-slot="kicker">x</p><p data-slot="nothing">y</p>') + section('b', '<p data-slot="kicker">z</p>')
    markEditable([blockData('a', { kicker: 'x' }), blockData('b', { kicker: 'z' }, { locked: true })])
    const nodes = document.querySelectorAll('p')
    expect(nodes[0].getAttribute('contenteditable')).toBe('plaintext-only')
    expect(nodes[1].hasAttribute('contenteditable')).toBe(false)
    expect(nodes[2].hasAttribute('contenteditable')).toBe(false)
  })

  it('closes a text that stopped being editable on the next render', () => {
    document.body.innerHTML = section('a', '<p data-slot="kicker">x</p>')
    markEditable([blockData('a', { kicker: 'x' })])
    markEditable([blockData('a', { kicker: 'x' }, { locked: true })])
    expect(document.querySelector('p')!.hasAttribute('data-lb-text')).toBe(false)
  })

  it('patches a plain text node and leaves anything riskier to the server', () => {
    document.body.innerHTML = section('a', '<p data-slot="kicker">old</p><p data-slot="rich">a<b>b</b></p><img data-slot="pic">')
    expect(patchText('a', 'kicker', 'جديد')).toBe(true)
    expect(document.querySelector('[data-slot="kicker"]')!.textContent).toBe('جديد')
    expect(patchText('a', 'kicker', '<b>x</b>')).toBe(false)
    expect(patchText('a', 'kicker', '   ')).toBe(false)
    expect(patchText('a', 'rich', 'x')).toBe(false)
    expect(patchText('a', 'pic', 'x')).toBe(false)
    expect(patchText('zzz', 'kicker', 'x')).toBe(false)
  })

  it('does not touch the text the user is typing in right now', () => {
    document.body.innerHTML = section('a', '<p data-slot="kicker" tabindex="0">typing</p>')
    const node = document.querySelector<HTMLElement>('p')!
    node.focus()
    expect(patchText('a', 'kicker', 'other')).toBe(true)
    expect(node.textContent).toBe('typing')
  })
})

describe('installInteractions', () => {
  let sent: FromFrame[]
  let current: PreviewPayload
  let stop: () => void

  const payload = (blocks: BlockData[], extra: Partial<PreviewPayload> = {}) =>
    ({ lang: 'ar', baseLang: 'ar', blocks, ...extra }) as unknown as PreviewPayload

  const mouse = (type: string, init: MouseEventInit & { pointerId?: number } = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
    return event
  }

  beforeEach(() => {
    sent = []
    document.body.innerHTML =
      '<div class="lb-stage">' +
      section('a', '<p data-slot="kicker" data-move="kicker">hello</p><span data-move="countdown">3</span>') +
      section('lock', '<p data-move="kicker">x</p>') +
      '<div class="lb-custom"><p data-move="ce-1">c</p><p data-move="kicker">k</p></div></div>'
    document.querySelector('.lb-stage')!.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect
    current = payload([blockData('a', { kicker: 'hello' }), blockData('lock', { kicker: 'x' }, { locked: true })])
    markEditable(current.blocks)
    stop = installInteractions({ payload: () => current, send: (m) => sent.push(m) })
  })
  afterEach(() => {
    stop()
    document.body.innerHTML = ''
  })

  const kicker = () => document.querySelector<HTMLElement>('[data-block="a"] [data-slot="kicker"]')!

  it('reports what the user types and selects the section when a text gets focus', () => {
    kicker().focus()
    expect(sent).toContainEqual({ type: 'lb-editor:select', id: 'a' })
    kicker().textContent = 'مرحباً'
    kicker().dispatchEvent(new Event('input', { bubbles: true }))
    expect(sent).toContainEqual({ type: 'lb-editor:text', id: 'a', key: 'kicker', value: 'مرحباً' })
  })

  it('refuses typing while the translated preview is on, and says so', () => {
    current = payload(current.blocks, { lang: 'en' })
    const event = new Event('beforeinput', { bubbles: true, cancelable: true })
    kicker().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(sent).toContainEqual({ type: 'lb-editor:refused' })
    kicker().dispatchEvent(new Event('input', { bubbles: true }))
    expect(sent.some((m) => m.type === 'lb-editor:text')).toBe(false)
  })

  it('drops the focus on Enter instead of adding a line', () => {
    kicker().focus()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    kicker().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(kicker())
  })

  it('drags an element and reports the final offset in cqw (stage 1000px → 10px per 1%)', () => {
    const node = document.querySelector<HTMLElement>('[data-move="countdown"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 100, clientY: 100 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 200, clientY: 150 }))
    expect(node.style.getPropertyValue('--dx')).toBe('10cqw')
    expect(node.style.getPropertyValue('--dy')).toBe('5cqw')
    expect(node.classList.contains('lb-dragging')).toBe(true)
    expect(document.querySelector('.lb-drag-badge')).not.toBeNull()
    node.dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:select', id: 'a' })
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: 'a', slot: 'countdown', dx: 10, dy: 5 })
    expect(document.querySelector('.lb-drag-badge')).toBeNull()
    expect(node.classList.contains('lb-dragging')).toBe(false)
    clearDragVars()
    expect(node.style.getPropertyValue('--dx')).toBe('')
  })

  it('continues from the saved offset and ignores a click or a tiny wobble', () => {
    current = payload([blockData('a', { kicker: 'h' }, { layout: { countdown: { dx: 4, dy: 0 } } })])
    const node = document.querySelector<HTMLElement>('[data-move="countdown"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 2, clientY: 1 }))
    node.dispatchEvent(mouse('pointerup'))
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)

    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 30, clientY: 0 }))
    node.dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: 'a', slot: 'countdown', dx: 7, dy: 0 })
  })

  it('Escape cancels the drag without reporting anything', () => {
    const node = document.querySelector<HTMLElement>('[data-move="countdown"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 100, clientY: 0 }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
    expect(node.style.getPropertyValue('--dx')).toBe('')
  })

  it('does not drag locked sections, imported boxes, pixel slots or non-left buttons', () => {
    const drag = (node: Element, init: MouseEventInit = {}) => {
      node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0, ...init }))
      node.dispatchEvent(mouse('pointermove', { clientX: 100, clientY: 0 }))
      node.dispatchEvent(mouse('pointerup'))
    }
    drag(document.querySelector('[data-block="lock"] [data-move]')!)
    drag(document.querySelector('.lb-custom [data-move="kicker"]')!)
    drag(document.querySelector('.lb-custom [data-move="ce-1"]')!)
    drag(document.querySelector('[data-move="countdown"]')!, { button: 2 })
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
  })

  it('lets the user place the caret inside a text that is already being edited', () => {
    const node = kicker()
    node.setAttribute('tabindex', '0')
    node.focus()
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 100, clientY: 0 }))
    node.dispatchEvent(mouse('pointerup'))
    expect(sent.some((m) => m.type === 'lb-editor:layout')).toBe(false)
  })
})

