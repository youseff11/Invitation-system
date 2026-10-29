import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FromFrame, PreviewPayload } from '../types'
import { beginTextEdit, commitSwap, installImported, markPicked, patchNode, prepareImported, WRITE_WAIT } from './frame'

/** كل العناصر ليها حجم حقيقي (jsdom مابيحسبش تخطيط). */
const SIZED = () => ({ width: 80, height: 30 }) as DOMRect

let sent: FromFrame[]
let picks: { id: string; slot: string }[]
let payload: PreviewPayload
let stop: (() => void) | undefined
const send = (m: FromFrame) => sent.push(m)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(SIZED)
  sent = []
  picks = []
  payload = { lang: 'ar', baseLang: 'ar', blocks: [] } as unknown as PreviewPayload
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const mountSection = (box: string) => {
  document.body.innerHTML = `<section data-block="b1" data-block-type="hero"><div class="lb-inner"></div>${box}</section>`
  return document.querySelector<HTMLElement>('.lb-extra-html')!
}
const NAMES = '<div class="lb-extra-html" data-move="code"><div class="names"><span class="a">ليلى</span><span class="b">كريم</span></div><img class="pic" src="a.png"></div>'

const arm = () => {
  prepareImported(payload, send)
  stop = installImported({ payload: () => payload, send, onPick: (p) => picks.push(p) })
}

describe('advanced-code box: numbering', () => {
  it('numbers its elements ce-N on the live DOM and reports their paths once', () => {
    const box = mountSection(NAMES)
    arm()
    const numbered = Array.from(box.querySelectorAll('[data-move]')).map((n) => `${n.className}:${n.getAttribute('data-move')}`)
    // الطبقات الخارجية (أبناء الصندوق المباشرين: ‎.names‎ و‎.pic‎) بتتّرقّم الأول، وبعدها وحدات النص والوسايط
    expect(numbered).toEqual(['names:ce-1', 'a:ce-3', 'b:ce-4', 'pic:ce-2'])
    const msg = sent.find((m) => m.type === 'lb-editor:code-number') as Extract<FromFrame, { type: 'lb-editor:code-number' }>
    expect(msg.id).toBe('b1')
    expect(msg.items).toEqual([
      { path: [0], slot: 'ce-1', tag: 'DIV' },
      { path: [1], slot: 'ce-2', tag: 'IMG' },
      { path: [0, 0], slot: 'ce-3', tag: 'SPAN' },
      { path: [0, 1], slot: 'ce-4', tag: 'SPAN' },
    ])
    // وحدات النص معلّمة للكتابة
    expect(box.querySelector('.a')!.getAttribute('data-lb-text')).toBe('1')
  })

  it('does not report again once the source carries the numbers (the re-render brings them from the server)', () => {
    mountSection(NAMES.replace('class="names"', 'class="names" data-move="ce-1"')
        .replace('class="a"', 'class="a" data-move="ce-3"')
        .replace('class="b"', 'class="b" data-move="ce-4"')
        .replace('class="pic"', 'class="pic" data-move="ce-2"'))
    arm()
    expect(sent.filter((m) => m.type === 'lb-editor:code-number')).toEqual([])
  })

  it('also numbers while the translated preview is shown (only data-move is written, never text)', () => {
    payload = { ...payload, lang: 'en' } as PreviewPayload
    mountSection(NAMES)
    arm()
    expect(sent.some((m) => m.type === 'lb-editor:code-number')).toBe(true)
  })

  it('the intro code box belongs to the pseudo block __intro', () => {
    document.body.innerHTML = '<div class="lb-intro"><div class="lb-intro-extra"><p>hello</p></div></div>'
    arm()
    const msg = sent.find((m) => m.type === 'lb-editor:code-number') as Extract<FromFrame, { type: 'lb-editor:code-number' }>
    expect(msg.id).toBe('__intro')
    expect(msg.items[0]).toMatchObject({ slot: 'ce-1', tag: 'P' })
  })
})

describe('advanced-code box: selecting and typing', () => {
  it('a click selects the element, and the box itself when the click is on its padding', () => {
    const box = mountSection(NAMES)
    arm()
    box.querySelector('.a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks.at(-1)).toEqual({ id: 'b1', slot: 'ce-3' })
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks.at(-1)).toEqual({ id: 'b1', slot: 'code' })
    markPicked({ id: 'b1', slot: 'ce-4' })
    expect(box.querySelector('.b')!.classList.contains('lb-el-picked')).toBe(true)
  })

  it('a click in the intro code selects an element of __intro', () => {
    document.body.innerHTML = '<div class="lb-intro"><div class="lb-intro-extra"><p>hello</p></div></div>'
    arm()
    document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks).toEqual([{ id: '__intro', slot: 'ce-1' }])
    markPicked({ id: '__intro', slot: 'ce-1' })
    expect(document.querySelector('p')!.classList.contains('lb-el-picked')).toBe(true)
  })

  it('a click on the intro code selects the element WITHOUT reaching the intro (which would open the invitation)', () => {
    document.body.innerHTML = '<div class="lb-intro"><div class="lb-intro-extra"><p>hello</p></div><button>open</button></div>'
    const opened = vi.fn()
    document.querySelector('.lb-intro')!.addEventListener('click', opened)
    arm()
    document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(picks).toEqual([{ id: '__intro', slot: 'ce-1' }])
    expect(opened).not.toHaveBeenCalled()
    // برّه كود الافتتاحية: الضغطة طبيعية وبتفتح
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(picks).toHaveLength(1)
  })

  it('typing sends only that element inner html by its number (never the whole box snapshot), then once more on blur', () => {
    const box = mountSection(NAMES.replace('<span class="a">', '<span class="a" tabindex="0">'))
    arm()
    sent.length = 0
    const a = box.querySelector<HTMLElement>('.a')!
    a.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(a.getAttribute('contenteditable')).toBe('plaintext-only')
    a.textContent = 'سلمى'
    a.dispatchEvent(new Event('input', { bubbles: true }))
    a.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(WRITE_WAIT + 1)
    const edits = sent.filter((m) => m.type === 'lb-editor:node-edits')
    expect(edits).toHaveLength(1) // اتجمّعت
    expect(edits[0]).toEqual({ type: 'lb-editor:node-edits', id: 'b1', edits: [{ slot: 'ce-3', edit: { kind: 'inner', html: 'سلمى' } }] })
    expect(sent.some((m) => m.type === 'lb-editor:html')).toBe(false)

    sent.length = 0
    a.textContent = 'سلمى ومحمد'
    a.dispatchEvent(new Event('input', { bubbles: true }))
    a.blur()
    expect(sent).toContainEqual({ type: 'lb-editor:node-edits', id: 'b1', edits: [{ slot: 'ce-3', edit: { kind: 'inner', html: 'سلمى ومحمد' } }] })
    expect(a.hasAttribute('contenteditable')).toBe(false)
  })

  it('keeps inline children of the unit and strips our marks from what it sends', () => {
    const box = mountSection('<div class="lb-extra-html" data-move="code"><h1 class="t" tabindex="0">ليلى<span>&amp;</span>كريم</h1></div>')
    arm()
    sent.length = 0
    const h1 = box.querySelector<HTMLElement>('.t')!
    beginTextEdit(h1, send, false)
    h1.dispatchEvent(new Event('input', { bubbles: true }))
    h1.blur()
    const msg = sent.find((m) => m.type === 'lb-editor:node-edits') as Extract<FromFrame, { type: 'lb-editor:node-edits' }>
    const edit = msg.edits[0].edit as { kind: 'inner'; html: string }
    expect(edit.html).toBe('ليلى<span>&amp;</span>كريم')
  })

  it('refuses to type in the translated preview', () => {
    payload = { ...payload, lang: 'en' } as PreviewPayload
    const box = mountSection(NAMES)
    arm()
    box.querySelector('.a')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(sent).toContainEqual({ type: 'lb-editor:refused' })
    expect(box.querySelector('.a')!.hasAttribute('contenteditable')).toBe(false)
  })
})

describe('advanced-code box: swap and live patch', () => {
  it('swapping two images reports both new sources by number', () => {
    const box = mountSection('<div class="lb-extra-html"><img data-move="ce-1" src="a.png" srcset="a2.png 2x"><img data-move="ce-2" src="b.png"></div>')
    const [a, b] = Array.from(box.querySelectorAll('img'))
    a.setAttribute('src', 'b.png')
    a.removeAttribute('srcset')
    b.setAttribute('src', 'a.png')
    b.setAttribute('srcset', 'a2.png 2x')
    commitSwap(a, b, send)
    expect(sent).toEqual([
      {
        type: 'lb-editor:node-edits',
        id: 'b1',
        edits: [
          { slot: 'ce-1', edit: { kind: 'attrs', values: { src: 'b.png', srcset: null } } },
          { slot: 'ce-2', edit: { kind: 'attrs', values: { src: 'a.png', srcset: 'a2.png 2x' } } },
        ],
      },
    ])
  })

  it('patchNode applies a panel edit to a code element, and to the intro code', () => {
    const box = mountSection(NAMES)
    arm()
    patchNode('b1', 'ce-3', { kind: 'style', prop: 'color', value: 'red' })
    expect(box.querySelector<HTMLElement>('.a')!.style.color).toBe('red')

    document.body.insertAdjacentHTML('beforeend', '<div class="lb-intro"><div class="lb-intro-extra"><p data-move="ce-1">x</p></div></div>')
    patchNode('__intro', 'ce-1', { kind: 'text', value: 'y' })
    expect(document.querySelector('.lb-intro p')!.textContent).toBe('y')
  })
})
