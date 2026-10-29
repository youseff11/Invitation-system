import { describe, expect, it } from 'vitest'

import { passPath, personalPath, qrPngUrl, venuePath, whatsappGuestUrl } from './links'

describe('guest links', () => {
  it('keeps the shared paths on the original /i/… routes (the ones QR codes encode)', () => {
    expect(personalPath('demo', 'tok')).toBe('/i/demo/g/tok/')
    expect(venuePath('demo', 'v')).toBe('/i/demo/venue/v/')
    expect(passPath('demo', 'tok')).toBe('/i/demo/g/tok/pass/')
    expect(qrPngUrl('demo', 'tok')).toBe('/i/demo/g/tok/qr.png')
  })

  it('builds the WhatsApp share link with an encoded name and the raw url', () => {
    expect(whatsappGuestUrl('منى فؤاد', 'http://x.test/i/a/g/b/')).toBe(
      `https://wa.me/?text=${encodeURIComponent('منى فؤاد')}%2C%20http://x.test/i/a/g/b/`,
    )
  })
})
