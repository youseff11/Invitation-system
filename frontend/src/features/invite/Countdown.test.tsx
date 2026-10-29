import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Countdown } from './blocks/Countdown'
import { block } from './fixtures'

const props = {
  heading: 'موعدنا',
  label_days: 'يوم',
  label_hours: 'ساعة',
  label_minutes: 'دقيقة',
  label_seconds: 'ثانية',
  show_seconds: true,
  finished_text: 'بدأ الفرح',
  variant: 'boxes',
  number_size: 40,
}

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00+03:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('shows the remaining time and ticks every second', () => {
    render(<Countdown block={block('countdown', { ...props, iso: '2026-11-02T00:16:18+00:00' })} />)
    const cells = () => Array.from(document.querySelectorAll('[data-cd]')).map((n) => n.textContent)
    // نفس القيم اللي في اللقطة المرجعية للموقع القديم عند نفس الوقت الثابت
    expect(cells()).toEqual(['09', '15', '16', '18'])
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(cells()).toEqual(['09', '15', '16', '17'])
  })

  it('hides seconds when disabled and keeps the data attributes the CSS targets', () => {
    render(<Countdown block={block('countdown', { ...props, show_seconds: false, iso: '2026-11-02T00:00:00+03:00' })} />)
    expect(document.querySelector('[data-cd="seconds"]')).toBeNull()
    const root = document.querySelector('.lb-countdown')!
    expect(root.getAttribute('data-no-seconds')).toBe('1')
    expect(root.getAttribute('data-move')).toBe('countdown')
  })

  it('shows the finished text once the date passed', () => {
    render(<Countdown block={block('countdown', { ...props, iso: '2026-10-01T00:00:00+03:00' })} />)
    expect(screen.getByText('بدأ الفرح')).toBeInTheDocument()
    expect(document.querySelector('.lb-countdown')!.classList.contains('is-done')).toBe(true)
  })

  it('keeps 00 for an invalid date', () => {
    render(<Countdown block={block('countdown', { ...props, iso: '' })} />)
    expect(Array.from(document.querySelectorAll('[data-cd]')).every((n) => n.textContent === '00')).toBe(true)
  })
})
