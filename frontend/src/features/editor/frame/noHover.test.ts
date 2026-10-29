import { afterEach, describe, expect, it } from 'vitest'

import { installNoHover, splitSelectors, stripHover } from './noHover'

const addStyle = (css: string) => {
  const style = document.head.appendChild(document.createElement('style'))
  style.textContent = css
  return style
}
const rulesOf = (style: HTMLStyleElement) => Array.from(style.sheet!.cssRules).map((r) => (r as CSSStyleRule).selectorText ?? r.cssText)

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('splitSelectors', () => {
  it('splits on top-level commas only', () => {
    expect(splitSelectors('.a, .b:is(.c, .d) , [data-x="1,2"]')).toEqual(['.a', '.b:is(.c, .d)', '[data-x="1,2"]'])
  })
})

describe('stripHover', () => {
  it('removes rules that only apply on hover and keeps the rest', () => {
    const style = addStyle('.card { color: red } .card:hover { transform: scale(2) } .btn:hover::after { content: "" } p { margin: 0 }')
    expect(stripHover()).toBe(2)
    expect(rulesOf(style)).toEqual(['.card', 'p'])
  })

  it('keeps the non-hover selectors of a grouped rule', () => {
    const style = addStyle('.a:hover, .b, .c:not(.d):hover { opacity: .5 }')
    stripHover()
    expect(rulesOf(style)).toEqual(['.b'])
  })

  it('goes into @media / @supports groups', () => {
    const style = addStyle('@media (hover: hover) { .x:hover { color: blue } .y { color: green } } @supports (display: grid) { .z:hover { top: 0 } }')
    stripHover()
    const inner = Array.from(style.sheet!.cssRules).map((r) => Array.from((r as CSSGroupingRule).cssRules).map((c) => (c as CSSStyleRule).selectorText))
    expect(inner).toEqual([['.y'], []])
  })

  it('handles a sheet once, and picks up a replaced style text as a new sheet', () => {
    const style = addStyle('.a:hover { color: red }')
    expect(stripHover()).toBe(1)
    expect(stripHover()).toBe(0)
    style.textContent = '.b:hover { color: red } .b { color: blue }'
    expect(stripHover()).toBe(1)
    expect(rulesOf(style)).toEqual(['.b'])
  })

  it('does nothing to a page without hover rules', () => {
    addStyle('.a { color: red }')
    expect(stripHover()).toBe(0)
  })

  it('installNoHover strips immediately and returns a disposer', () => {
    const style = addStyle('.a:hover { color: red }')
    const stop = installNoHover()
    expect(rulesOf(style)).toEqual([])
    stop()
  })
})
