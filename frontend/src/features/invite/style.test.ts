import { describe, expect, it } from 'vitest'

import { fluid, parseStyle } from './style'

describe('parseStyle', () => {
  it('parses custom properties and camel-cases normal ones', () => {
    expect(parseStyle('--block-pt:80px;font-size:12px;--x: a b ')).toEqual({
      '--block-pt': '80px',
      fontSize: '12px',
      '--x': 'a b',
    })
  })

  it('does not split on semicolons inside url() or quotes', () => {
    const style = parseStyle(`--bg:url("a;b.png");--font:'A;B', serif;color:red`) as Record<string, string>
    expect(style['--bg']).toBe('url("a;b.png")')
    expect(style['--font']).toBe(`'A;B', serif`)
    expect(style.color).toBe('red')
  })

  it('ignores empty or malformed declarations', () => {
    expect(parseStyle('')).toEqual({})
    expect(parseStyle(';;novalue;a:')).toEqual({})
  })

  it('maps vendor prefixes', () => {
    expect(parseStyle('-webkit-text-size-adjust:100%')).toEqual({ WebkitTextSizeAdjust: '100%' })
  })
})

describe('fluid (mirror of templatetags.invite._fluid)', () => {
  it('matches the server output format', () => {
    expect(fluid(76, { floor: 46 })).toBe('clamp(46.0px, 10.0cqw, 76.0px)')
    expect(fluid(38, { ref: 760 })).toBe('clamp(19.8px, 5.0cqw, 38.0px)')
    expect(fluid(17, { ref: 720 })).toBe('clamp(8.8px, 2.361cqw, 17.0px)')
  })

  it('returns 0px for missing or invalid sizes', () => {
    expect(fluid(undefined)).toBe('0px')
    expect(fluid('abc')).toBe('0px')
    expect(fluid(-4)).toBe('0px')
  })

  it('never lets the floor exceed the size', () => {
    expect(fluid(20, { floor: 50 })).toBe('clamp(20.0px, 2.632cqw, 20.0px)')
  })
})
