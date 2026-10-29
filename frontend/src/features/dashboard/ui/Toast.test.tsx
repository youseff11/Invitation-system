import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'
import { ToastProvider, errorText, useToast } from './Toast'

function Buttons() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast.success('تم الحفظ')}>success</button>
      <button onClick={() => toast.warning('انتبه')}>warning</button>
      <button onClick={() => toast.fail(new ApiError(400, 'validation_error', 'راجع البيانات'))}>api-error</button>
      <button onClick={() => toast.fail(new TypeError('Failed to fetch'))}>network</button>
      <button onClick={() => toast.fail(new Error('boom'))}>unknown</button>
    </>
  )
}

function setup() {
  render(
    <ToastProvider>
      <Buttons />
    </ToastProvider>,
  )
}

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Toast', () => {
  it('shows a success toast as a status and removes it after its lifetime', () => {
    setup()
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByRole('status')).toHaveTextContent('تم الحفظ')
    act(() => void vi.advanceTimersByTime(5100))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces API errors with the server message as an alert', () => {
    setup()
    fireEvent.click(screen.getByText('api-error'))
    expect(screen.getByRole('alert')).toHaveTextContent('راجع البيانات')
  })

  it('falls back to generic texts for network and unknown failures', () => {
    setup()
    fireEvent.click(screen.getByText('network'))
    expect(screen.getByRole('alert')).toHaveTextContent('تعذّر الاتصال بالخادم')
    fireEvent.click(screen.getByText('unknown'))
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('حصل خطأ غير متوقع')
  })

  it('can be dismissed by hand', () => {
    setup()
    fireEvent.click(screen.getByText('warning'))
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(screen.queryByText('انتبه')).not.toBeInTheDocument()
  })

  it('keeps at most four toasts on screen', () => {
    setup()
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByText('success'))
    expect(screen.getAllByRole('status')).toHaveLength(4)
  })

  it('errorText prefers the ApiError message and ignores empty ones', () => {
    expect(errorText(new ApiError(404, 'not_found', 'مش موجود'), 'g', 'n')).toBe('مش موجود')
    expect(errorText(new ApiError(500, 'http_error', ''), 'g', 'n')).toBe('g')
    expect(errorText(new TypeError('x'), 'g', 'n')).toBe('n')
    expect(errorText('x', 'g', 'n')).toBe('g')
  })
})
