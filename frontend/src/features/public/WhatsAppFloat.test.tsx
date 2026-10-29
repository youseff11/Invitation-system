import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { keys } from '@/api/hooks'
import type { SiteInfo } from '@/api/types'
import { initI18n } from '@/i18n'
import { WhatsAppFloat } from './WhatsAppFloat'

function site(whatsapp: Partial<SiteInfo['whatsapp']>): SiteInfo {
  return {
    whatsapp: {
      floatReady: true,
      url: 'https://wa.me/201000000000?text=hi',
      base: 'https://wa.me/201000000000',
      message: 'رسالة افتراضية',
      ...whatsapp,
    },
  } as SiteInfo
}

function renderFloat(info: SiteInfo) {
  const client = new QueryClient()
  client.setQueryData(keys.site, info)
  return render(
    <QueryClientProvider client={client}>
      <WhatsAppFloat />
    </QueryClientProvider>,
  )
}

const chat = (container: HTMLElement) => container.querySelector<HTMLElement>('#wa-chat')!
const float = (container: HTMLElement) => container.querySelector<HTMLAnchorElement>('.wa-float')!

describe('WhatsAppFloat', () => {
  beforeAll(() => {
    initI18n('ar')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when the float is not ready (disabled or no number)', () => {
    const { container } = renderFloat(site({ floatReady: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the chat window on click instead of following the link, and closes on Escape', () => {
    const { container } = renderFloat(site({}))
    expect(chat(container).hidden).toBe(true)

    fireEvent.click(float(container))
    expect(chat(container).hidden).toBe(false)
    expect(float(container)).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chat(container).hidden).toBe(true)
    expect(float(container)).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when the visitor presses outside the window', () => {
    const { container } = renderFloat(site({}))
    fireEvent.click(float(container))
    fireEvent.pointerDown(document.body)
    expect(chat(container).hidden).toBe(true)
  })

  it('opens WhatsApp with the typed message ready, and the default one when empty', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const { container } = renderFloat(site({}))

    fireEvent.click(float(container))
    const input = screen.getByPlaceholderText('اكتب رسالتك…')
    fireEvent.change(input, { target: { value: 'عايز أسأل عن الباقات' } })
    fireEvent.submit(input.closest('form')!)
    expect(open).toHaveBeenLastCalledWith(
      `https://wa.me/201000000000?text=${encodeURIComponent('عايز أسأل عن الباقات')}`,
      '_blank',
    )
    expect(chat(container).hidden).toBe(true)

    fireEvent.click(float(container))
    fireEvent.submit(screen.getByPlaceholderText('اكتب رسالتك…').closest('form')!)
    expect(open).toHaveBeenLastCalledWith(
      `https://wa.me/201000000000?text=${encodeURIComponent('رسالة افتراضية')}`,
      '_blank',
    )
  })

  it('falls back to the plain link when there is no number to chat with', () => {
    const { container } = renderFloat(site({ base: '' }))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      float(container).dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(false)
    expect(chat(container).hidden).toBe(true)
  })
})
