import { afterEach, describe, expect, it, vi } from 'vitest'

import { compressImage, MAX_EDGE } from './imageCompress'

const file = (type: string, size: number, name = 'hero.png') => new File([new Uint8Array(size)], name, { type })

afterEach(() => vi.unstubAllGlobals())

describe('compressImage', () => {
  it('leaves non-images, svg, gif, webp and small jpegs alone', async () => {
    for (const f of [file('application/pdf', 5e6), file('image/svg+xml', 5e6), file('image/gif', 5e6), file('image/webp', 5e6), file('image/jpeg', 1000)]) {
      expect(await compressImage(f)).toBe(f)
    }
  })

  it('returns the original when the browser cannot decode images', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const big = file('image/png', 5e6)
    expect(await compressImage(big)).toBe(big)
  })

  it('downsizes to the max edge and returns a smaller webp with the same name stem', async () => {
    const draw = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4800, height: 2700, close: vi.fn() })))
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? ({ width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(1000)], { type: 'image/webp' })) } as unknown as HTMLCanvasElement)
        : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as typeof document.createElement)
    const out = await compressImage(file('image/png', 5e6, 'My Hero.png'))
    expect(out.type).toBe('image/webp')
    expect(out.name).toBe('My Hero.webp')
    expect(out.size).toBe(1000)
    const [, , , width, height] = draw.mock.calls[0]
    expect([width, height]).toEqual([MAX_EDGE, 1350])
  })

  it('keeps the original when the result is not smaller or encoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })))
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement)
        : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as typeof document.createElement)
    const png = file('image/png', 5e6)
    expect(await compressImage(png)).toBe(png)
  })
})
