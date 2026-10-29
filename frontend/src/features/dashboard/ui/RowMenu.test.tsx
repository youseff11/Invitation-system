import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import { RowMenu, RowMenuButton, RowMenuCopy, RowMenuLink, RowMenuTitle } from './RowMenu'

function setup(onDuplicate = vi.fn()) {
  render(
    <div>
      <p>outside</p>
      <RowMenu label="الروابط">
        <RowMenuTitle>الدعوة</RowMenuTitle>
        <RowMenuLink href="/i/demo/">فتح الدعوة</RowMenuLink>
        <RowMenuCopy text="https://site.test/i/demo/">نسخ رابط الدعوة</RowMenuCopy>
        <RowMenuButton icon="⎘" onClick={onDuplicate}>
          عمل نسخة
        </RowMenuButton>
      </RowMenu>
    </div>,
  )
  return { trigger: screen.getByRole('button', { name: /الروابط/ }) }
}

const pop = () => document.querySelector('.rowmenu-pop') as HTMLElement

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => vi.useRealTimers())

describe('RowMenu', () => {
  it('opens and closes from its trigger', () => {
    const { trigger } = setup()
    expect(pop()).toHaveAttribute('hidden')
    fireEvent.click(trigger)
    expect(pop()).not.toHaveAttribute('hidden')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(trigger)
    expect(pop()).toHaveAttribute('hidden')
  })

  it('closes on Escape and on an outside click', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(pop()).toHaveAttribute('hidden')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('outside'))
    expect(pop()).toHaveAttribute('hidden')
  })

  it('opens links in a new tab safely', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const link = screen.getByRole('link', { name: /فتح الدعوة/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
  })

  it('runs an action and closes the menu', () => {
    const onDuplicate = vi.fn()
    const { trigger } = setup(onDuplicate)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /عمل نسخة/ }))
    expect(onDuplicate).toHaveBeenCalledOnce()
    expect(pop()).toHaveAttribute('hidden')
  })

  it('copies the link, confirms it, then closes the menu a moment later', async () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /نسخ رابط الدعوة/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://site.test/i/demo/')
    expect(screen.getByText('✓ اتنسخ')).toBeInTheDocument()
    expect(pop()).not.toHaveAttribute('hidden')

    act(() => void vi.advanceTimersByTime(1200))
    expect(pop()).toHaveAttribute('hidden')
    act(() => void vi.advanceTimersByTime(600))
    expect(screen.queryByText('✓ اتنسخ')).not.toBeInTheDocument()
  })

  it('falls back to a prompt when the clipboard is blocked', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    const { trigger } = setup()
    fireEvent.click(trigger)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /نسخ رابط الدعوة/ }))
    })
    expect(prompt).toHaveBeenCalledWith('انسخ الرابط:', 'https://site.test/i/demo/')
    expect(screen.queryByText('✓ اتنسخ')).not.toBeInTheDocument()
    prompt.mockRestore()
  })
})
