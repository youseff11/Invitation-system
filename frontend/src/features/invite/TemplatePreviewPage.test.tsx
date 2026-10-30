import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import { block, payload } from './fixtures'
import TemplatePreviewPage from './TemplatePreviewPage'

function json(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="templates/:slug/preview" element={<TemplatePreviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TemplatePreviewPage (in-app template preview)', () => {
  beforeEach(() => {
    initI18n('ar')
    document.body.className = ''
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fetches the template payload, shows the preview and puts the page in invite mode', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      json(200, payload({ kind: 'template', slug: 'golden', blocks: [block('hero', { name_one: 'ليلى', names_layout: 'stacked' })] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/templates/golden/preview?lang=en')

    await waitFor(() => expect(document.querySelector('section[data-block-type="hero"]')).not.toBeNull())
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/templates/golden/preview/')
    expect(url.searchParams.get('lang')).toBe('en')
    expect(document.body.classList.contains('lb-doc')).toBe(true)
  })

  it('shows the not-found page when the template does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(404, { error: { code: 'not_found', message: 'nope' } })))
    renderAt('/templates/missing/preview')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
    expect(document.querySelector('section[data-block-type]')).toBeNull()
  })
})
