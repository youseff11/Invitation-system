import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n, { initI18n } from '@/i18n'
import { LanguageSwitch } from './LanguageSwitch'

const fetchMock = vi.fn<typeof fetch>()

describe('LanguageSwitch', () => {
  beforeAll(() => {
    initI18n('ar')
  })

  beforeEach(() => {
    document.cookie = 'csrftoken=tok'
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ language: 'en' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    localStorage.clear()
    await i18n.changeLanguage('ar')
    document.documentElement.lang = 'ar'
    document.documentElement.dir = 'rtl'
  })

  it('shows the language it will switch to', () => {
    render(<LanguageSwitch />)
    expect(screen.getByRole('button', { name: 'Switch to English' })).toHaveTextContent('EN')
  })

  it('switches instantly and tells the server in the background', async () => {
    render(<LanguageSwitch />)

    fireEvent.click(screen.getByRole('button'))

    // من غير انتظار للسيرفر: اللغة والاتجاه اتغيّروا في نفس اللحظة
    expect(i18n.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(localStorage.getItem('farha-lang')).toBe('en')
    expect(screen.getByRole('button', { name: 'التبديل إلى العربية' })).toHaveTextContent('ع')

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/v1/language/')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"language":"en"}')
  })

  it('keeps the new language even if the server call fails', () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<LanguageSwitch />)
    fireEvent.click(screen.getByRole('button'))
    expect(i18n.language).toBe('en')
  })
})
