import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FromFrame, PreviewPayload } from '../types'
import { beginTextEdit, installImported, markPicked, prepareImported, WRITE_WAIT } from './frame'
import { numberElements } from './numbering'
import { cleanCopy, serializeCustom } from './serialize'
import { isCountdownLabel, isImportedCountdownPart, isTextUnit, isTildaTextUnit, movableIn } from './units'

/** كل العناصر ليها حجم حقيقي (jsdom مابيحسبش تخطيط). */
const SIZED = () => ({ width: 80, height: 30 }) as DOMRect

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(SIZED)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const mount = (html: string) => {
  document.body.innerHTML = `<section data-block="b1" data-block-type="custom_html"><div class="lb-custom">${html}</div></section>`
  return document.querySelector('.lb-custom') as HTMLElement
}

describe('text-unit detection', () => {
  it('treats a heading with inline children as one text unit, but not a container of blocks', () => {
    const root = mount('<h1>ليلى <span>&amp;</span> كريم</h1><div><p>a</p><p>b</p></div><p><a href="#">x</a></p>')
    const [h1, box, p] = [root.querySelector('h1')!, root.querySelector('div')!, root.querySelector('p:last-child')!]
    expect(isTextUnit(h1)).toBe(true)
    expect(isTextUnit(box)).toBe(false) // DIV مش وسم نصي
    expect(isTextUnit(p)).toBe(true)
    expect(isTextUnit(root.querySelector('span')!)).toBe(true)
  })

  it('rejects empty text, nested structure inside inline children and media', () => {
    const root = mount('<p></p><p><span><b>x</b></span></p><p><img src="a.png"></p>')
    const ps = root.querySelectorAll('p')
    expect(Array.from(ps).map(isTextUnit)).toEqual([false, false, false])
  })

  it('recognises Tilda text atoms and ignores atoms with media inside', () => {
    const root = mount('<div class="tn-atom">نص <b>مهم</b></div><div class="tn-atom"><img src="a.png">x</div><div class="tn-atom"> </div>')
    expect(Array.from(root.querySelectorAll('.tn-atom')).map(isTildaTextUnit)).toEqual([true, false, false])
  })

  it('keeps the imported countdown out of text editing (its script writes the numbers)', () => {
    const root = mount('<div id="countdown"><span class="cd-days">10</span><span class="label">يوم</span></div><p>عادي</p>')
    const days = root.querySelector('.cd-days')!
    expect(isImportedCountdownPart(days)).toBe(true)
    expect(isTextUnit(days)).toBe(false)
    expect(isCountdownLabel(root.querySelector('.label')!)).toBe(true)
    expect(isTextUnit(root.querySelector('p')!)).toBe(true)
  })

  it('movableIn skips line breaks and elements without real size', () => {
    const root = mount('<p>a<br>b</p><hr><i class="tiny"></i>')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return (this.classList.contains('tiny') ? { width: 2, height: 2 } : { width: 80, height: 30 }) as DOMRect
    })
    expect(movableIn(root).map((n) => n.tagName)).toEqual(['P'])
  })
})

describe('numberElements', () => {
  it('marks text units, numbers movable nodes and keeps children of a text unit out', () => {
    const root = mount('<h1>ليلى <span>&amp;</span> كريم</h1><img src="a.png"><div class="shape"></div>')
    const { nodes, changed } = numberElements(root)
    expect(changed).toBe(true)
    expect(root.querySelector('h1')!.getAttribute('data-lb-text')).toBe('1')
    expect(root.querySelector('h1 span')!.hasAttribute('data-move')).toBe(false)
    expect(nodes.map((n) => n.getAttribute('data-move'))).toEqual(['el-1', 'el-2', 'el-3'])
  })

  it('keeps existing numbers, fills gaps without reusing a taken id', () => {
    const root = mount('<p data-move="el-2">a</p><p>b</p><p data-move="el-1">c</p><p>d</p>')
    const { changed } = numberElements(root)
    expect(changed).toBe(true)
    expect(Array.from(root.querySelectorAll('p')).map((n) => n.getAttribute('data-move'))).toEqual(['el-2', 'el-3', 'el-1', 'el-4'])
  })

  it('is idempotent: a second pass over the same DOM changes nothing (no save/render loop)', () => {
    const root = mount('<h1>ليلى</h1><img src="a.png">')
    expect(numberElements(root).changed).toBe(true)
    const html = root.innerHTML
    expect(numberElements(root).changed).toBe(false)
    expect(root.innerHTML).toBe(html)
  })

  it('does not renumber after it was saved and re-rendered', () => {
    const root = mount('<h1>ليلى</h1><div class="shape"></div>')
    numberElements(root)
    const saved = serializeCustom(root)
    const again = mount(saved)
    expect(numberElements(again).changed).toBe(false)
    expect(serializeCustom(again)).toBe(saved)
  })
})

describe('serializeCustom / cleanCopy', () => {
  it('strips editor marks but keeps the numbering', () => {
    const root = mount(
      '<h1 data-move="el-1" data-lb-text="1" data-lb-edit="1" contenteditable="plaintext-only" class="title lb-el-typing lb-el-picked" ' +
        'style="--dx:3px;--dy:2px;box-shadow:0 0 0 2px red;outline:none;color:red">ليلى</h1><p class="lb-el-picked" style="outline:none">x</p>',
    )
    const html = serializeCustom(root)
    expect(html).toContain('data-move="el-1"')
    expect(html).toContain('class="title"')
    expect(html).toContain('style="color: red;"')
    expect(html).not.toMatch(/contenteditable|data-lb-|lb-el-|--dx|box-shadow|outline/)
    expect(html).toContain('<p>x</p>')
    // الأصل ما اتلمسش
    expect(root.querySelector('h1')!.hasAttribute('contenteditable')).toBe(true)
  })

  it('cleanCopy drops ids and marks so a pasted element gets a fresh number', () => {
    const root = mount('<div data-move="el-5" class="card lb-el-picked"><p data-move="el-6" data-lb-text="1">x</p></div>')
    const copy = cleanCopy(root.firstElementChild!)
    expect(copy.outerHTML).toBe('<div class="card"><p>x</p></div>')
  })
})

describe('frame binding', () => {
  let sent: FromFrame[]
  let payload: PreviewPayload
  let picks: { id: string; slot: string }[]
  let stop: () => void
  const send = (m: FromFrame) => sent.push(m)

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    picks = []
    payload = { lang: 'ar', baseLang: 'ar', blocks: [] } as unknown as PreviewPayload
  })
  afterEach(() => {
    stop?.()
    vi.useRealTimers()
  })

  const setup = (html: string) => {
    const root = mount(html)
    prepareImported(payload, send)
    stop = installImported({ payload: () => payload, send, onPick: (p) => picks.push(p) })
    return root
  }

  it('saves the numbering once (silently) after the first render, then never again', () => {
    const root = setup('<h1>ليلى</h1><img src="a.png">')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(WRITE_WAIT + 1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'lb-editor:html', id: 'b1', silent: true })
    expect((sent[0] as { value: string }).value).toContain('data-move="el-1"')

    // الـDOM اتبدّل بالنسخة المحفوظة (React بيكتب innerHTML من الرد) → مفيش كتابة جديدة
    sent.length = 0
    root.innerHTML = (sent as unknown as never[]).length ? '' : serializeFromMessage()
    prepareImported(payload, send)
    vi.advanceTimersByTime(WRITE_WAIT * 3)
    expect(sent).toEqual([])
  })

  function serializeFromMessage() {
    return '<h1 data-move="el-1">ليلى</h1><img src="a.png" data-move="el-2">'
  }

  it('does not write numbering while the translated preview is shown', () => {
    payload = { ...payload, lang: 'en' } as PreviewPayload
    setup('<h1>Layla</h1>')
    vi.advanceTimersByTime(WRITE_WAIT * 3)
    expect(sent).toEqual([])
  })

  it('a click selects the nearest numbered element and reports it', () => {
    const root = setup('<h1>ليلى</h1><div class="shape"><p>x</p></div>')
    root.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks).toEqual([{ id: 'b1', slot: 'el-1' }])
    expect(sent).toContainEqual({ type: 'lb-editor:element', id: 'b1', slot: 'el-1' })
    markPicked({ id: 'b1', slot: 'el-1' })
    expect(root.querySelector('h1')!.classList.contains('lb-el-picked')).toBe(true)
    markPicked(null)
    expect(document.querySelector('.lb-el-picked')).toBeNull()
  })

  it('double-click opens a text unit for typing and writes back when it loses focus', () => {
    const root = setup('<h1 tabindex="0">ليلى</h1>')
    vi.advanceTimersByTime(WRITE_WAIT + 1)
    sent.length = 0
    const h1 = root.querySelector<HTMLElement>('h1')!
    h1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(h1.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(h1.classList.contains('lb-el-typing')).toBe(true)
    expect(document.activeElement).toBe(h1)

    h1.textContent = 'سلمى'
    h1.dispatchEvent(new Event('input', { bubbles: true }))
    h1.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(WRITE_WAIT + 1)
    expect(sent.filter((m) => m.type === 'lb-editor:html')).toHaveLength(1) // اتجمّعت
    expect(sent.find((m) => m.type === 'lb-editor:html')).toMatchObject({ silent: false })

    sent.length = 0
    h1.textContent = 'سلمى ومحمد'
    h1.dispatchEvent(new Event('input', { bubbles: true }))
    h1.blur()
    const html = sent.find((m) => m.type === 'lb-editor:html') as { value: string; silent: boolean }
    expect(html.value).toContain('سلمى ومحمد')
    expect(html.value).not.toMatch(/contenteditable|lb-el-typing|data-lb-text/)
    expect(html.silent).toBe(false)
    expect(h1.hasAttribute('contenteditable')).toBe(false)
  })

  it('Escape leaves typing but keeps the element', () => {
    const root = setup('<h1 tabindex="0">ليلى</h1>')
    const h1 = root.querySelector<HTMLElement>('h1')!
    beginTextEdit(h1, send, false)
    h1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.activeElement).not.toBe(h1)
    expect(h1.classList.contains('lb-el-typing')).toBe(false)
  })

  it('refuses to type in the translated preview', () => {
    payload = { ...payload, lang: 'en' } as PreviewPayload
    const root = setup('<h1>Layla</h1>')
    const h1 = root.querySelector<HTMLElement>('h1')!
    h1.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(sent).toContainEqual({ type: 'lb-editor:refused' })
    expect(h1.hasAttribute('contenteditable')).toBe(false)
  })

  it('ignores clicks outside imported sections', () => {
    setup('<p>x</p>')
    document.body.insertAdjacentHTML('beforeend', '<section data-block="b2"><p data-move="el-1">y</p></section>')
    document.querySelector('[data-block="b2"] p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks).toEqual([])
  })
})
