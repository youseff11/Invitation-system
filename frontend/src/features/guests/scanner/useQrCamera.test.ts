import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useQrCamera } from './useQrCamera'

function fakeVideo() {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true })
  video.play = () => Promise.resolve()
  return video
}

function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
}

function stubDetector(detect: () => Promise<{ rawValue?: string }[]>) {
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect = detect
    },
  )
}

/** نفس ‎useRef‎: كائن واحد ثابت بين الرسمات. */
const ref = { current: fakeVideo() }

const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream

describe('useQrCamera', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('reports an unsupported browser and disables the start button', () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    const { result } = renderHook(() => useQrCamera(ref, vi.fn()))
    expect(result.current.support).toBe('noCamera')
    expect(result.current.canStart).toBe(false)
  })

  it('reads codes with BarcodeDetector when the browser has it', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: '  FRH-ABC123 ' }])
    stubDetector(detect)
    stubCamera(() => Promise.resolve(stream()))
    const onCode = vi.fn()
    const { result } = renderHook(() => useQrCamera(ref, onCode))

    await act(async () => result.current.start())
    expect(result.current.active).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(detect).toHaveBeenCalled()
    expect(onCode).toHaveBeenCalledWith('FRH-ABC123')
  })

  it('ignores frames with no code', async () => {
    stubDetector(vi.fn().mockResolvedValue([]))
    stubCamera(() => Promise.resolve(stream()))
    const onCode = vi.fn()
    const { result } = renderHook(() => useQrCamera(ref, onCode))
    await act(async () => result.current.start())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(onCode).not.toHaveBeenCalled()
  })

  it('stops every track and goes idle on stop()', async () => {
    stubDetector(vi.fn().mockResolvedValue([]))
    const track = { stop: vi.fn() }
    stubCamera(() => Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream))
    const { result } = renderHook(() => useQrCamera(ref, vi.fn()))
    await act(async () => result.current.start())
    act(() => result.current.stop())
    expect(track.stop).toHaveBeenCalled()
    expect(result.current.active).toBe(false)
  })

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'notFound'],
    ['NotReadableError', 'busy'],
  ])('maps the %s camera error to the %s message', async (name, support) => {
    stubCamera(() => Promise.reject(Object.assign(new Error(name), { name })))
    const { result } = renderHook(() => useQrCamera(ref, vi.fn()))
    await act(async () => result.current.start())
    expect(result.current.active).toBe(false)
    expect(result.current.support).toBe(support)
  })
})
