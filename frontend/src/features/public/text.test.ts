import { describe, expect, it } from 'vitest'

import { contactChannel } from './pixel'
import { firstChar, pick, truncateChars } from './text'

describe('bilingual text helpers', () => {
  it('picks the English text only for English with a non-empty value', () => {
    expect(pick('en', 'ذهبي', 'Golden')).toBe('Golden')
    expect(pick('en', 'ذهبي', '  ')).toBe('ذهبي')
    expect(pick('ar', 'ذهبي', 'Golden')).toBe('ذهبي')
  })

  it('truncates like Django truncatechars (the ellipsis counts)', () => {
    expect(truncateChars('abcdef', 6)).toBe('abcdef')
    expect(truncateChars('abcdefg', 6)).toBe('abcde…')
    expect(truncateChars('', 80)).toBe('')
  })

  it('takes the first character, even outside the BMP', () => {
    expect(firstChar('ذهبي')).toBe('ذ')
    expect(firstChar('😀x')).toBe('😀')
    expect(firstChar('')).toBe('')
  })
})

describe('Meta Pixel contact channel', () => {
  it('recognizes WhatsApp, phone and email links only', () => {
    expect(contactChannel('https://wa.me/20100')).toBe('whatsapp')
    expect(contactChannel('https://api.whatsapp.com/send?phone=1')).toBe('whatsapp')
    expect(contactChannel('tel:+20100')).toBe('phone')
    expect(contactChannel('mailto:a@b.c')).toBe('email')
    expect(contactChannel('/templates/')).toBe('')
  })
})
