import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pointTarget } from './pointTarget'

/** كاروسيل داخل «كود متقدّم»: شرائح فوق بعض، النشطة بس باينة (الباقي ‎opacity: 0‎ بس عناصره المرقّمة بتاخد ضغط) */
const HTML =
  '<div data-block="b1"><div class="lb-extra-html">' +
  '<ul>' +
  '<li id="first"><span id="t1" data-move="ce-1" data-lb-text="1">07:00</span></li>' +
  '<li id="last" style="opacity: 0; pointer-events: none"><span id="t2" data-move="ce-2" data-lb-text="1">12:00</span></li>' +
  '</ul></div></div>'

const click = (target: Element) => {
  const e = new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
  Object.defineProperty(e, 'target', { value: target })
  return e
}

describe('pointTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = HTML
  })
  afterEach(() => {
    // @ts-expect-error — jsdom ما عندوش elementsFromPoint؛ نرجّعه زي ما كان
    delete document.elementsFromPoint
  })

  const stack = (nodes: Element[]) => {
    document.elementsFromPoint = () => nodes
  }
  const $ = (id: string) => document.getElementById(id)!

  it('skips an invisible (opacity 0) numbered element lying on top of the visible one', () => {
    stack([$('t2'), $('t1')])
    expect(pointTarget(click($('t2')))).toBe($('t1'))
  })

  it('keeps the clicked element when it is visible', () => {
    stack([$('t1'), $('t2')])
    expect(pointTarget(click($('t1')))).toBe($('t1'))
  })

  it('falls back to the clicked element when nothing visible is under the pointer', () => {
    stack([$('t2')])
    expect(pointTarget(click($('t2')))).toBe($('t2'))
  })

  it('treats visibility: hidden like invisible', () => {
    $('last').style.opacity = ''
    $('last').style.visibility = 'hidden'
    stack([$('t2'), $('t1')])
    expect(pointTarget(click($('t2')))).toBe($('t1'))
  })
})
