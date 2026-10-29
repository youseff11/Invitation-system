import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import i18n, { initI18n } from '@/i18n'
import type { ScanData } from '../types'
import { describeScan, entryProblem, useScanFlow } from './useScanFlow'

const guest: ScanData = {
  already: false,
  error: '',
  id: 7,
  name: 'علي',
  code: 'FRH-ABC123',
  group: 'العائلة',
  companions: 1,
  used: 1,
  allowed: 2,
  left: 1,
  status: 'active',
  rsvpStatus: 'attending',
  at: '21:30',
  arrived: 4,
  total: 9,
}

beforeAll(() => {
  initI18n('ar')
})

describe('describeScan', () => {
  const t = i18n.t.bind(i18n)

  it('shows a green result with the counter, the meta line and the time', () => {
    const result = describeScan(t, guest)
    expect(result.kind).toBe('ok')
    expect(result.title).toBe('✓ علي')
    expect(result.lines).toEqual([
      '1 من 2 · متبقي 1',
      'FRH-ABC123 · العائلة · الرد: سيحضر',
      'الساعة 21:30',
    ])
  })

  it('marks the last entry as complete', () => {
    expect(describeScan(t, { ...guest, used: 2, left: 0 }).lines[0]).toContain('اكتمل')
  })

  it('turns a used-up pass into a red warning built from the numbers', () => {
    const result = describeScan(t, { ...guest, already: true, error: 'x', used: 2, left: 0 })
    expect(result.kind).toBe('bad')
    expect(result.title).toBe('✕ علي — التصريح خلص — اتمسح 2 من 2.')
  })

  it('explains a guest with no pass', () => {
    expect(entryProblem(t, 0, 0)).toContain('مالوش تصريح')
    expect(entryProblem(t, 1, 3)).toContain('1 من 3')
  })
})

describe('useScanFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  function setup(scan: (token: string) => Promise<ScanData>, onScanned?: (d: ScanData) => void) {
    return renderHook(() => useScanFlow({ scan, onScanned }))
  }

  it('records the result, the log and the counters after a scan', async () => {
    const scan = vi.fn().mockResolvedValue(guest)
    const onScanned = vi.fn()
    const { result } = setup(scan, onScanned)
    await act(async () => result.current.submit('TOKEN-1'))
    expect(scan).toHaveBeenCalledWith('TOKEN-1')
    expect(result.current.result?.kind).toBe('ok')
    expect(result.current.log).toEqual(['21:30 — علي (1/2)'])
    expect(result.current.counts).toEqual({ arrived: 4, total: 9 })
    expect(onScanned).toHaveBeenCalledWith(guest)
  })

  it('ignores the same code scanned again within 2.5 seconds, but not a manual entry', async () => {
    const scan = vi.fn().mockResolvedValue(guest)
    const { result } = setup(scan)
    await act(async () => result.current.submit('TOKEN-1'))
    await act(async () => result.current.submit('TOKEN-1'))
    expect(scan).toHaveBeenCalledTimes(1)
    await act(async () => result.current.submit('TOKEN-1', true))
    expect(scan).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date('2026-10-23T12:00:05Z'))
    await act(async () => result.current.submit('TOKEN-1'))
    expect(scan).toHaveBeenCalledTimes(3)
  })

  it('does not log a pass that was already used up', async () => {
    const scan = vi.fn().mockResolvedValue({ ...guest, already: true, error: 'x' })
    const { result } = setup(scan)
    await act(async () => result.current.submit('TOKEN-1'))
    expect(result.current.result?.kind).toBe('bad')
    expect(result.current.log).toEqual([])
  })

  it('keeps only the latest 12 entries, newest first', async () => {
    let n = 0
    const scan = vi.fn().mockImplementation(async () => ({ ...guest, name: `ضيف ${++n}`, allowed: 1 }))
    const { result } = setup(scan)
    for (let i = 0; i < 14; i++) await act(async () => result.current.submit(`T${i}`, true))
    expect(result.current.log).toHaveLength(12)
    expect(result.current.log[0]).toBe('21:30 — ضيف 14')
  })

  it('translates API failures and network errors', async () => {
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'guest_not_found', 'x'))
      .mockRejectedValueOnce(new ApiError(400, 'invalid_token', 'x'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = setup(scan)
    await act(async () => result.current.submit('A', true))
    expect(result.current.result?.title).toBe('✕ الرمز ده مش من ضيوف الدعوة دي.')
    await act(async () => result.current.submit('B', true))
    expect(result.current.result?.title).toBe('✕ رمز غير صالح.')
    await act(async () => result.current.submit('C', true))
    expect(result.current.result?.title).toBe('✕ تعذّر الاتصال بالخادم')
    expect(result.current.log).toEqual([])
  })

  it('flash() shows a message in the same result box', () => {
    const { result } = setup(vi.fn())
    act(() => result.current.flash('✓ تم', 'ok'))
    expect(result.current.result).toEqual({ kind: 'ok', title: '✓ تم', lines: [] })
  })
})
