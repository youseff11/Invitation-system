import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import { ConfirmProvider } from '../ui/ConfirmDialog'
import { ToastProvider } from '../ui/Toast'
import { IntrosPage } from './IntrosPage'
import { VideosPage } from './VideosPage'

const clip = (id: number, name: string) => ({
  id,
  name,
  note: '',
  url: `/media/v/${id}.mp4`,
  posterUrl: '',
  secondsLabel: '4.0',
  order: 0,
  isActive: true,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** يحاكي الـAPI ويسجّل الطلبات الكاتبة. */
function mockApi() {
  const calls: { method: string; url: string; body?: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/site/')) return json({ name: { ar: 'تي ديزاينيشن', en: 'T DESIGNATION' } })
      if (method === 'PATCH') return json({ ...clip(1, 'الاسم الجديد') })
      if (method === 'POST') return json(clip(1, 'فيديو الحنة'))
      if (url.endsWith('/dashboard/videos/')) return json({ results: [clip(1, 'فيديو الحنة')] })
      if (url.endsWith('/dashboard/intros/')) return json({ results: [clip(2, 'افتتاحية ذهبية')] })
      return json({})
    }),
  )
  return calls
}

function renderPage(page: 'videos' | 'intros') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>{page === 'videos' ? <VideosPage /> : <IntrosPage />}</ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  document.cookie = 'csrftoken=tok'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('video libraries', () => {
  it('shows each video as a preview card (not a table)', async () => {
    mockApi()
    renderPage('videos')
    await screen.findByText('فيديو الحنة')
    expect(document.querySelector('table')).toBeNull()
    expect(document.querySelector('.clip-card video')).not.toBeNull()
  })

  it('renames a video with PATCH and refreshes', async () => {
    const calls = mockApi()
    renderPage('videos')
    await screen.findByText('فيديو الحنة')
    fireEvent.click(screen.getByRole('button', { name: 'إعادة تسمية' }))
    const input = screen.getByRole('textbox', { name: 'اسم الفيديو' })
    fireEvent.change(input, { target: { value: '  الاسم الجديد ' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', url: '/api/v1/dashboard/videos/1/', body: { name: 'الاسم الجديد' } }),
    )
  })

  it('Escape cancels the rename without calling the API', async () => {
    const calls = mockApi()
    renderPage('videos')
    await screen.findByText('فيديو الحنة')
    fireEvent.click(screen.getByRole('button', { name: 'إعادة تسمية' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'اسم الفيديو' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'اسم الفيديو' })).not.toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('moves a video to the intros after confirming', async () => {
    const calls = mockApi()
    renderPage('videos')
    await screen.findByText('فيديو الحنة')
    fireEvent.click(screen.getByRole('button', { name: 'انقل للافتتاحيات' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('فيديو الحنة')
    expect(calls).toEqual([]) // لسه ماتنقلش
    fireEvent.click(screen.getAllByRole('button', { name: 'انقل للافتتاحيات' }).at(-1)!)
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/dashboard/videos/1/move/', body: undefined }))
  })

  it('the intro library can rename too, but has no move button', async () => {
    mockApi()
    renderPage('intros')
    await screen.findByText('افتتاحية ذهبية')
    expect(screen.getByRole('button', { name: 'إعادة تسمية' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'انقل للافتتاحيات' })).not.toBeInTheDocument()
  })
})
