import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEditor, useEditor } from '../store'
import type { Bootstrap, FromFrame } from '../types'
import { clearBounds, showBounds, snapHeight } from './sectionBounds'

let sent: FromFrame[]
const send = (m: FromFrame) => sent.push(m)
const mouse = (type: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

beforeEach(() => {
  sent = []
  document.body.innerHTML =
    '<section data-block="b1"><div class="lb-inner"><div class="lb-custom"><div class="t396__artboard"></div></div></div></section><section data-block="b2"></section>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return { width: 390, height: this.classList.contains('t396__artboard') ? 783 : 100, left: 0, top: 0 } as DOMRect
  })
})
afterEach(() => {
  clearBounds()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const bounds = { id: 'b1', key: 'section_height_mobile', label: 'حدود القسم · موبايل', stored: 0 }
const handle = () => document.querySelector<HTMLElement>('.lb-section-resize-handle')!

describe('snapHeight', () => {
  it('rounds to 10 and stays inside 120–2400', () => {
    expect([784, 794, 10, 99999].map(snapHeight)).toEqual([780, 790, 120, 2400])
  })
})

describe('section bounds overlay', () => {
  it('draws a frame + handle in the section, labelled with the real artboard height when nothing is stored', () => {
    showBounds(bounds, send)
    expect(document.querySelectorAll('[data-lb-section-bounds]')).toHaveLength(1)
    expect(document.querySelector('[data-block="b1"] .lb-section-bounds__label')?.textContent).toBe('حدود القسم · موبايل · 783px')
    expect(document.querySelector('[data-block="b2"] .lb-section-bounds')).toBeNull()
  })

  it('shows the stored height instead when there is one; null or another call clears the old frame', () => {
    showBounds({ ...bounds, stored: 640 }, send)
    expect(document.querySelector('.lb-section-bounds__label')?.textContent).toContain('640px')
    showBounds({ ...bounds, id: 'b2' }, send)
    expect(document.querySelectorAll('[data-lb-section-bounds]')).toHaveLength(1)
    showBounds(null, send)
    expect(document.querySelector('[data-lb-section-bounds]')).toBeNull()
  })

  it('dragging the handle sets every section layer live (!important) and reports the snapped height once, on release', () => {
    showBounds(bounds, send)
    handle().dispatchEvent(mouse('pointerdown', { clientY: 500 }))
    handle().dispatchEvent(mouse('pointermove', { clientY: 612 })) // 783 + 112 = 895 ← 900
    const artboard = document.querySelector<HTMLElement>('.t396__artboard')!
    const section = document.querySelector<HTMLElement>('[data-block="b1"]')!
    for (const node of [section, artboard, document.querySelector<HTMLElement>('.lb-inner')!, document.querySelector<HTMLElement>('.lb-custom')!]) {
      expect(node.style.getPropertyValue('height')).toBe('900px')
      expect(node.style.getPropertyPriority('height')).toBe('important')
      expect(node.style.getPropertyValue('min-height')).toBe('900px')
    }
    expect(document.querySelector('.lb-section-bounds__label')?.textContent).toContain('900px')
    expect(sent).toEqual([])
    handle().dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:section-height', id: 'b1', key: 'section_height_mobile', value: 900 }])
  })

  it('a click on the handle without moving reports nothing and does not select anything', () => {
    showBounds(bounds, send)
    handle().dispatchEvent(mouse('pointerdown', { clientY: 10 }))
    handle().dispatchEvent(mouse('pointerup'))
    const click = mouse('click')
    handle().dispatchEvent(click)
    expect(sent).toEqual([])
    expect(click.defaultPrevented).toBe(true)
  })

  it('does nothing for a section that is not in the page', () => {
    showBounds({ ...bounds, id: 'gone' }, send)
    expect(document.querySelector('[data-lb-section-bounds]')).toBeNull()
  })
})

describe('store flag', () => {
  const boot = (): Bootstrap => ({
    mode: 'template', id: 1, title: 't',
    document: {
      version: 1, theme: {}, settings: {},
      blocks: ['a', 'b'].map((id) => ({ id, type: 'text', visible: true, locked: false, props: {}, style: {} })),
    },
    fields: null, features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
    meta: { slug: 's', status: '', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  })

  it('toggles for a section and closes when another section is selected', () => {
    resetEditor()
    useEditor.getState().load(boot())
    useEditor.getState().select('a', 'preview')
    useEditor.getState().toggleBounds('a')
    expect(useEditor.getState().boundsBlock).toBe('a')
    useEditor.getState().select('a', 'preview') // نفس القسم: يفضل
    expect(useEditor.getState().boundsBlock).toBe('a')
    useEditor.getState().select('b', 'preview')
    expect(useEditor.getState().boundsBlock).toBeNull()
    useEditor.getState().toggleBounds('b')
    useEditor.getState().toggleBounds('b')
    expect(useEditor.getState().boundsBlock).toBeNull()
  })
})
