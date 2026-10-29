import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { block, payload } from './fixtures'
import { InviteApp } from './InviteApp'
import type { RenderPayload } from './types'

function json(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

const hero = (name: string) =>
  block('hero', { name_one: name, name_two: '', names_layout: 'stacked', height: 'full', name_size: 76, name_size_mobile: 46 })

describe('InviteApp', () => {
  beforeEach(() => {
    document.cookie = 'csrftoken=tok'
    window.history.replaceState({}, '', '/app/i/demo/')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the blocks with the attributes the CSS and text styles target', () => {
    render(<InviteApp boot={{ mode: 'view', ...payload({ blocks: [hero('ليلى')] }) }} />)
    const section = document.querySelector('section#hero-1')!
    expect(section.getAttribute('data-block-type')).toBe('hero')
    expect(section.className).toContain('lb--hero')
    expect(section.querySelector('[data-ts="name_one"]')!.textContent).toBe('ليلى')
    expect(document.querySelector('footer.lb-footer')!.textContent).toContain('T DESIGNATION')
  })

  it('reveals a lazily loaded block (video) once its chunk replaces the placeholder', async () => {
    const watched = new Set<Element>()
    class FakeObserver {
      observe(node: Element) {
        watched.add(node)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const video = block('video', { url: '/media/a.mp4' }, {
      attrs: { id: 'video-1', className: 'lb lb--video lb-anim lb-anim--fade', style: '' },
    })
    render(<InviteApp boot={{ mode: 'view', ...payload({ blocks: [video] }) }} />)
    await waitFor(() => expect(document.querySelector('section#video-1 video')).not.toBeNull())
    await waitFor(() => expect(watched.has(document.querySelector('section#video-1')!)).toBe(true))
  })

  it('template preview has a WhatsApp share button; a real invitation does not', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    window.history.replaceState({}, '', '/templates/golden-night/preview/')
    const cta = { text: 'عجبك القالب؟', template_name: 'ليلة ذهبية', whatsapp: '', facebook: '' }
    const { unmount } = render(
      <InviteApp boot={{ mode: 'view', ...payload({ kind: 'template', cta, blocks: [hero('ليلى')] }) }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'مشاركة القالب على واتساب' }))
    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://wa.me/')
    const text = url.searchParams.get('text') ?? ''
    expect(text).toContain('ليلة ذهبية')
    expect(text).toContain(`${window.location.origin}/templates/golden-night/preview/`)
    unmount()

    render(<InviteApp boot={{ mode: 'view', ...payload({ blocks: [hero('ليلى')] }) }} />)
    expect(document.querySelector('[data-template-share]')).toBeNull()
    open.mockRestore()
  })

  it('skips unknown block types instead of crashing', () => {
    render(<InviteApp boot={{ mode: 'view', ...payload({ blocks: [block('from-the-future'), hero('ليلى')] }) }} />)
    expect(document.querySelectorAll('[data-block]').length).toBe(1)
  })

  it('switches language in place: fetches once, updates document attributes and the URL', async () => {
    const en: RenderPayload = payload({
      lang: 'en',
      dir: 'ltr',
      altLang: 'ar',
      hasAlt: true,
      blocks: [hero('Layla')],
      bodyStyle: '--bg:#000',
      head: { title: 'Layla', description: 'Wedding', image: { url: '', width: 0, height: 0 }, favicon: '', canonical: '' },
      css: { font: '', layout: '[data-ts="name_one"]{font-family:A !important}', shared: '', zero: '' },
    })
    const fetchMock = vi.fn().mockImplementation(() => json(200, en))
    vi.stubGlobal('fetch', fetchMock)
    render(<InviteApp boot={{ mode: 'view', ...payload({ hasAlt: true, blocks: [hero('ليلى')] }) }} />)

    const toggle = screen.getByRole('link', { name: 'View in English' })
    expect(toggle.textContent).toBe('EN')
    fireEvent.click(toggle)

    await waitFor(() => expect(document.querySelector('[data-ts="name_one"]')!.textContent).toBe('Layla'))
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(document.title).toBe('Layla')
    expect(location.search).toBe('?lang=en')
    expect(document.head.querySelector('style[data-lb-layout-css]')!.textContent).toContain('font-family:A')
    // زرار اللغة بقى بيشاور على العربي
    expect(screen.getByRole('link', { name: 'اعرض بالعربية' }).textContent).toBe('ع')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('lang=en')).length).toBeGreaterThanOrEqual(1)
  })

  it('shows the password form, rejects a wrong password, then loads the invitation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/unlock/')) {
        const body = JSON.parse(String(init?.body))
        return body.password === 'good'
          ? json(200, { ok: true })
          : json(401, { error: { code: 'wrong_password', message: 'x' } })
      }
      return json(200, payload({ blocks: [hero('ليلى')], css: { font: '', layout: '', shared: '', zero: '' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<InviteApp boot={{ mode: 'locked', slug: 'demo', siteName: 'T' }} />)

    const input = await screen.findByPlaceholderText('كلمة السر')
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText('كلمة السر غير صحيحة.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'good' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(document.querySelector('section#hero-1')).not.toBeNull())
  })
})
