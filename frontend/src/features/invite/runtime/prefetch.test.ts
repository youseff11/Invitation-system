import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { directMediaUrl, prefetchVideo } from './prefetch'

const ok = (size = 1000) => ({
  ok: true,
  headers: { get: () => String(size) },
  body: { cancel: () => Promise.resolve() },
  blob: () => Promise.resolve(new Blob(['x'.repeat(10)], { type: 'video/mp4' })),
})

describe('video prefetch', () => {
  let n = 0
  beforeEach(() => {
    n = 0
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('maps /media-video/ to /media/ (served by the host, no Django worker)', () => {
    expect(directMediaUrl('/media-video/a/b.mp4')).toBe('/media/a/b.mp4')
    expect(directMediaUrl('https://x.com/media-video/a.mp4')).toBe('https://x.com/media/a.mp4')
    expect(directMediaUrl('https://cdn.x/v.mp4')).toBe('https://cdn.x/v.mp4')
  })

  it('downloads one video at a time, in the order asked', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const fetchMock = vi.fn((url: string) => {
      order.push(`start ${url}`)
      if (url.includes('intro')) {
        return new Promise((r) => {
          release = () => {
            order.push('end intro')
            r(ok())
          }
        })
      }
      return Promise.resolve(ok())
    })
    vi.stubGlobal('fetch', fetchMock)
    const a = prefetchVideo('/media-video/intro.mp4', new AbortController().signal, 1e6)
    const b = prefetchVideo('/media-video/next.mp4', new AbortController().signal, 1e6)
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['start /media/intro.mp4']) // التاني مستني دوره
    release()
    expect(await a).toBe('blob:1')
    expect(await b).toBe('blob:2')
    expect(order).toEqual(['start /media/intro.mp4', 'end intro', 'start /media/next.mp4'])
  })

  it('falls back to the original url when /media/ fails', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.startsWith('/media/') ? { ...ok(), ok: false } : ok()),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await prefetchVideo('/media-video/a.mp4', new AbortController().signal, 1e6)).toBe('blob:1')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/media/a.mp4', '/media-video/a.mp4'])
  })

  it('skips files over the limit and lets the next one start', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(ok(url.includes('big') ? 5e6 : 100)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await prefetchVideo('/media-video/big.mp4', new AbortController().signal, 1e6)).toBe('')
    expect(await prefetchVideo('/media-video/small.mp4', new AbortController().signal, 1e6)).toBe('blob:1')
  })

  it('does nothing once cancelled', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(ok()))
    vi.stubGlobal('fetch', fetchMock)
    const ctl = new AbortController()
    ctl.abort()
    expect(await prefetchVideo('/media-video/a.mp4', ctl.signal, 1e6)).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
