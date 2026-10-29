import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEditor, useEditor } from '../store'
import type { Bootstrap, DocBlock, FromFrame, PreviewPayload } from '../types'
import { installExtraDrags, prepareExtras } from './extraDrags'
import { installInteractions } from './interactions'

let sent: FromFrame[]
let stop: (() => void) | undefined

const mouse = (type: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}
const rect = (width: number, height: number, left = 0) => () => ({ width, height, left, top: 0, right: left + width, bottom: height }) as DOMRect

beforeEach(() => {
  sent = []
  document.body.innerHTML =
    '<section data-block="b1" data-block-type="hero"><div class="lb-inner"></div>' +
    '<div class="lb-section-text lb-ovl" data-section-text data-section-text-index="1" style="--video-text-x:10%;--video-text-y:-5%;--section-text-w:40%">نص</div>' +
    '<div class="lb-section-text" data-section-text data-section-text-index="0" style="--video-text-x:0%;--video-text-y:0%"><a class="lb-ovl-btn" href="https://x.test">link</a></div></section>' +
    '<div class="lb-intro"><p data-intro-item="text" style="--intro-item-x:2vw;--intro-item-y:-1vh">hi</p><button data-intro-item="button">open</button>' +
    '<div class="lb-intro-extra" data-intro-item="code"><p data-move="ce-1">c</p></div></div>'
  document.querySelector('section')!.getBoundingClientRect = rect(400, 800)
  stop = installExtraDrags({ send: (m) => sent.push(m) })
})
afterEach(() => {
  stop?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const overlay = () => document.querySelector<HTMLElement>('[data-section-text-index="1"]')!

describe('section text overlays', () => {
  it('drags by a percentage of the section, live via CSS vars, one message at the end', () => {
    overlay().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    overlay().dispatchEvent(mouse('pointermove', { clientX: 40, clientY: 80 }))
    expect(overlay().style.getPropertyValue('--video-text-x')).toBe('20%') // 10 + 40/400
    expect(overlay().style.getPropertyValue('--video-text-y')).toBe('5%') // -5 + 80/800
    expect(sent).toEqual([{ type: 'lb-editor:overlay-pick', id: 'b1', index: 1 }]) // الضغطة بتحدّده، والإزاحة بتتبعت مرة واحدة في الآخر
    overlay().dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:overlay-pick', id: 'b1', index: 1 }, { type: 'lb-editor:overlay', id: 'b1', index: 1, values: { x: 20, y: 5 } }])
    expect(overlay().classList.contains('is-dragging')).toBe(false)
  })

  it('ignores a click or a tiny wobble, and swallows the click that ends a real drag', () => {
    overlay().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    overlay().dispatchEvent(mouse('pointermove', { clientX: 2, clientY: 1 }))
    overlay().dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:overlay-pick', id: 'b1', index: 1 }]) // ضغطة من غير سحب = تحديد بس

    overlay().dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    overlay().dispatchEvent(mouse('pointermove', { clientX: 30, clientY: 0 }))
    overlay().dispatchEvent(mouse('pointerup'))
    const click = mouse('click')
    overlay().dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('blocks the native image and link drag inside an overlay (it would cancel our drag), but not elsewhere', () => {
    const native = () => new Event('dragstart', { bubbles: true, cancelable: true })
    const inside = native()
    document.querySelector('[data-section-text] a')!.dispatchEvent(inside)
    expect(inside.defaultPrevented).toBe(true)
    const outside = native()
    document.body.dispatchEvent(outside)
    expect(outside.defaultPrevented).toBe(false)
  })

  it('a button link inside an overlay never navigates the preview', () => {
    const click = mouse('click')
    document.querySelector('[data-section-text] a')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('width grips are added once per overlay and resize symmetrically in percent of the section', () => {
    prepareExtras()
    prepareExtras()
    expect(overlay().querySelectorAll('.lb-section-text__grip')).toHaveLength(2)
    overlay().getBoundingClientRect = rect(160, 30, 100) // 40% من ٤٠٠
    const grips = overlay().querySelectorAll<HTMLElement>('.lb-section-text__grip')
    grips[0].getBoundingClientRect = rect(12, 34, 94) // مقبض شمال
    grips[1].getBoundingClientRect = rect(12, 34, 254) // مقبض يمين
    grips[1].dispatchEvent(mouse('pointerdown', { clientX: 260, clientY: 0 }))
    grips[1].dispatchEvent(mouse('pointermove', { clientX: 300, clientY: 0 }))
    expect(overlay().style.getPropertyValue('--section-text-w')).toBe('60%') // (160 + 2×40) / 400
    grips[1].dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:overlay-pick', id: 'b1', index: 1 }, { type: 'lb-editor:overlay', id: 'b1', index: 1, values: { width: 60 } }])
  })

  it('clamps the width between 8% and 100%', () => {
    prepareExtras()
    overlay().getBoundingClientRect = rect(160, 30, 100)
    const grip = overlay().querySelectorAll<HTMLElement>('.lb-section-text__grip')[1]
    grip.getBoundingClientRect = rect(12, 34, 254)
    grip.dispatchEvent(mouse('pointerdown', { clientX: 260, clientY: 0 }))
    grip.dispatchEvent(mouse('pointermove', { clientX: 900, clientY: 0 }))
    expect(overlay().style.getPropertyValue('--section-text-w')).toBe('100%')
    grip.dispatchEvent(mouse('pointermove', { clientX: -900, clientY: 0 }))
    expect(overlay().style.getPropertyValue('--section-text-w')).toBe('8%')
  })
})

describe('intro items', () => {
  const item = (key: string) => document.querySelector<HTMLElement>(`[data-intro-item="${key}"]`)!

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 500)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('marks the intro editable for the dashed-outline CSS', () => {
    prepareExtras()
    expect(document.querySelector('.lb-intro')!.hasAttribute('data-intro-editable')).toBe(true)
  })

  it('drags in vw/vh from the saved position and reports the final one', () => {
    item('text').dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    item('text').dispatchEvent(mouse('pointermove', { clientX: 100, clientY: 50 }))
    expect(item('text').style.getPropertyValue('--intro-item-x')).toBe('12vw') // 2 + 100/10
    expect(item('text').style.getPropertyValue('--intro-item-y')).toBe('9vh') // -1 + 50/5
    item('text').dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:intro-item', key: 'text', x: 12, y: 9 }])
    expect(item('text').classList.contains('lb-intro-dragging')).toBe(false)
  })

  it('clamps to ±35 and swallows the click after a drag (it would open the invitation)', () => {
    item('button').dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    item('button').dispatchEvent(mouse('pointermove', { clientX: 5000, clientY: -5000 }))
    item('button').dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([{ type: 'lb-editor:intro-item', key: 'button', x: 35, y: -35 }])
    const click = mouse('click')
    const reached = vi.fn()
    document.querySelector('.lb-intro')!.addEventListener('click', reached)
    item('button').dispatchEvent(click)
    expect(reached).not.toHaveBeenCalled()
  })

  it('does not take over a numbered element inside the intro code (it drags alone, in pixels)', () => {
    document.querySelector('[data-move="ce-1"]')!.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    document.querySelector('[data-move="ce-1"]')!.dispatchEvent(mouse('pointermove', { clientX: 50, clientY: 0 }))
    document.querySelector('[data-move="ce-1"]')!.dispatchEvent(mouse('pointerup'))
    expect(sent).toEqual([])
  })
})

describe('intro-code element drag (interactions)', () => {
  it('moves a ce-N element of the intro code in pixels and files it under __intro, starting from the saved offset', () => {
    let stopInteractions: (() => void) | undefined
    const payload = { lang: 'ar', baseLang: 'ar', blocks: [] } as unknown as PreviewPayload
    document.body.innerHTML =
      '<style>.lb-intro [data-move="ce-1"]{--dx:10px;--dy:4px}</style><div class="lb-stage"></div><div class="lb-intro"><div class="lb-intro-extra"><p data-move="ce-1">c</p></div></div>'
    stopInteractions = installInteractions({ payload: () => payload, send: (m) => sent.push(m) })
    const node = document.querySelector<HTMLElement>('[data-move="ce-1"]')!
    node.dispatchEvent(mouse('pointerdown', { clientX: 0, clientY: 0 }))
    node.dispatchEvent(mouse('pointermove', { clientX: 40, clientY: 0 }))
    expect(node.style.getPropertyValue('--dx')).toBe('50px')
    node.dispatchEvent(mouse('pointerup'))
    expect(sent).toContainEqual({ type: 'lb-editor:layout', id: '__intro', slot: 'ce-1', dx: 50, dy: 4 })
    stopInteractions()
  })
})

describe('store', () => {
  const block = (extra: Partial<DocBlock> = {}): DocBlock => ({
    id: 'a', type: 'hero', visible: true, locked: false, style: {}, ...extra,
    props: { text_overlays: [{ kind: 'text', text: 'one', x: 0, y: 0 }, { kind: 'text', text: 'two', x: 5, y: 5, width: 30 }] },
  })
  const boot = (blocks: DocBlock[], settings: Record<string, unknown> = {}): Bootstrap => ({
    mode: 'template', id: 1, title: 't',
    document: { version: 1, theme: {}, settings, blocks },
    fields: null, features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
    meta: { slug: 's', status: '', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  })
  const s = () => useEditor.getState()
  const overlays = () => s().doc.blocks[0].props.text_overlays as Record<string, unknown>[]

  beforeEach(() => {
    resetEditor()
    s().load(boot([block()]))
  })

  it('setOverlay merges x/y/width into that overlay only, one undo step per drag', () => {
    s().setOverlay('a', 1, { x: 12, y: -3 })
    s().setOverlay('a', 1, { x: 13, y: -3 })
    s().setOverlay('a', 1, { width: 55 })
    expect(overlays()[1]).toMatchObject({ text: 'two', x: 13, y: -3, width: 55 })
    expect(overlays()[0]).toEqual({ kind: 'text', text: 'one', x: 0, y: 0 })
    expect(s().history).toHaveLength(1)
    s().undo()
    expect(overlays()[1]).toMatchObject({ x: 5, y: 5, width: 30 })
  })

  it('setOverlay ignores a missing overlay, a missing block and a locked section', () => {
    s().setOverlay('a', 9, { x: 1 })
    s().setOverlay('nope', 0, { x: 1 })
    s().load(boot([block({ locked: true })]))
    s().setOverlay('a', 0, { x: 1 })
    expect(overlays()[0]).toMatchObject({ x: 0 })
    expect(s().history).toHaveLength(0)
  })

  it('setIntroItem writes the JSON table, keeping the other items', () => {
    s().load(boot([], { intro_item_positions: '{"text":{"x":1,"y":2}}' }))
    s().setIntroItem('button', 3, -4)
    expect(JSON.parse(String(s().doc.settings.intro_item_positions))).toEqual({ text: { x: 1, y: 2 }, button: { x: 3, y: -4 } })
    s().setIntroItem('button', 9, 9)
    expect(JSON.parse(String(s().doc.settings.intro_item_positions)).button).toEqual({ x: 9, y: 9 })
    expect(s().history).toHaveLength(1) // نفس العنصر بيتسحب متتالي = خطوة
  })

  it('setIntroItem survives a corrupt table', () => {
    s().load(boot([], { intro_item_positions: 'nope' }))
    s().setIntroItem('text', 1, 1)
    expect(JSON.parse(String(s().doc.settings.intro_item_positions))).toEqual({ text: { x: 1, y: 1 } })
  })
})
