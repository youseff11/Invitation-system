import { describe, expect, it } from 'vitest'

import { collectColors, replaceColor } from './colors'
import { mapEmbedUrl } from './map'

describe('mapEmbedUrl', () => {
  it('returns nothing for empty, unreadable or shortened links', () => {
    expect(mapEmbedUrl('')).toBe('')
    expect(mapEmbedUrl(null)).toBe('')
    expect(mapEmbedUrl('https://maps.app.goo.gl/abc123')).toBe('')
    expect(mapEmbedUrl('https://goo.gl/maps/abc')).toBe('')
    expect(mapEmbedUrl('<iframe width="300"></iframe>')).toBe('')
    expect(mapEmbedUrl('x'.repeat(301))).toBe('')
  })

  it('takes the src out of a pasted embed code and decodes &amp;', () => {
    const code = '<iframe src="https://www.google.com/maps/embed?pb=!1m18&amp;z=3" width="600"></iframe>'
    expect(mapEmbedUrl(code)).toBe('https://www.google.com/maps/embed?pb=!1m18&z=3')
  })

  it('keeps an embeddable link as it is, and links to other sites untouched', () => {
    expect(mapEmbedUrl('https://www.google.com/maps?q=cairo&output=embed')).toBe('https://www.google.com/maps?q=cairo&output=embed')
    expect(mapEmbedUrl('https://example.com/map')).toBe('https://example.com/map')
  })

  it('turns coordinates (also Arabic comma) into an embed with a street-level zoom', () => {
    expect(mapEmbedUrl('29.990823, 31.130000')).toBe('https://www.google.com/maps?q=29.990823,31.13&z=16&output=embed')
    expect(mapEmbedUrl('30.04،31.23')).toBe('https://www.google.com/maps?q=30.04,31.23&z=16&output=embed')
    // خط عرض برّه المدى (٩٥) مش إحداثيات — بيتعامل كنص بحث
    expect(mapEmbedUrl('95, 31')).toBe('https://www.google.com/maps?q=95,%2031&output=embed')
  })

  it('reads the place from a share link: @lat,lng,zoom, !3d!4d, q=, /place/', () => {
    expect(mapEmbedUrl('https://www.google.com/maps/@30.0444,31.2357,15z')).toBe('https://www.google.com/maps?q=30.0444,31.2357&z=15&output=embed')
    expect(mapEmbedUrl('https://www.google.com/maps/place/Pyramids/data=!3d29.9792!4d31.1342')).toBe(
      'https://www.google.com/maps?q=29.9792,31.1342&z=16&output=embed',
    )
    expect(mapEmbedUrl('https://www.google.com/maps?q=30.1,31.2&z=12')).toBe('https://www.google.com/maps?q=30.1,31.2&z=12&output=embed')
    expect(mapEmbedUrl('https://www.google.com/maps/place/Cairo+Opera+House/@30.04,31.22,17z')).toBe(
      'https://www.google.com/maps?q=30.04,31.22&z=17&output=embed',
    )
    expect(mapEmbedUrl('https://www.google.com/maps/place/Cairo+Opera+House')).toBe('https://www.google.com/maps?q=Cairo%20Opera%20House&output=embed')
    expect(mapEmbedUrl('https://www.google.com/maps?q=Opera%20House')).toBe('https://www.google.com/maps?q=Opera%20House&output=embed')
  })

  it('treats plain text as a search', () => {
    expect(mapEmbedUrl('Cairo Opera House')).toBe('https://www.google.com/maps?q=Cairo%20Opera%20House&output=embed')
  })
})

describe('section colours', () => {
  const CSS = '.a{color:#C1272D;background:#fff}.b{border-color:#c1272d}.c{color:rgb(34, 68, 170)}'
  const HTML = '<p style="color: #c1272d">x</p><i style="color:#abc">y</i>'

  it('collects every colour, folding hex case, short hex and rgb, most used first', () => {
    const colors = collectColors(CSS, HTML)
    expect(colors[0]).toMatchObject({ hex: '#c1272d', count: 3 })
    expect(colors[0].raws.sort()).toEqual(['#C1272D', '#c1272d'])
    expect(colors.map((c) => c.hex)).toEqual(expect.arrayContaining(['#ffffff', '#2244aa', '#aabbcc']))
    expect(colors.find((c) => c.hex === '#ffffff')?.raws).toEqual(['#fff'])
  })

  it('caps the list and ignores text without colours', () => {
    expect(collectColors('', '<p>x</p>')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => `#${(i + 16).toString(16).repeat(3)}`).join(' ')
    expect(collectColors(many, '')).toHaveLength(12)
  })

  it('replaces every written form of one colour and nothing else', () => {
    const out = replaceColor(CSS, ['#C1272D', '#c1272d'], '#112233')
    expect(out).toBe('.a{color:#112233;background:#fff}.b{border-color:#112233}.c{color:rgb(34, 68, 170)}')
    expect(replaceColor('abc', [], '#000')).toBe('abc')
    expect(replaceColor('abc', [''], '#000')).toBe('abc')
  })
})
