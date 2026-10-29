import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import type { DedupeResult } from '../types'
import { ConfirmProvider } from '../ui/ConfirmDialog'
import { ToastProvider } from '../ui/Toast'
import { MusicPage } from './MusicPage'

const track = (id: number, name = 'Zein') => ({
  id,
  name,
  note: 'جاي مع قالب مستورد',
  url: `/media/music/${id}.mp3`,
  order: 0,
  isActive: true,
})

const plan = (over: Partial<DedupeResult> = {}): DedupeResult => ({
  dryRun: true,
  removeCount: 2,
  keepCount: 1,
  repointedDocs: 0,
  freedBytes: 0,
  groups: [],
  ...over,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** يحاكي الـAPI: القايمة، ومسح المكرر (فحص ثم تنفيذ). */
function mockApi(opts: { duplicateExtra: number; dryRun?: DedupeResult; apply?: DedupeResult }) {
  const posts: { dryRun: boolean }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/music/dedupe/')) {
      const body = JSON.parse(String(init?.body)) as { dryRun: boolean }
      posts.push(body)
      return json(body.dryRun ? (opts.dryRun ?? plan()) : (opts.apply ?? plan({ dryRun: false })))
    }
    if (url.endsWith('/site/')) return json({ name: { ar: 'تي ديزاينيشن', en: 'T DESIGNATION' } })
    if (url.endsWith('/dashboard/music/')) {
      return json({ results: [track(1), track(2), track(3)], duplicateExtra: opts.duplicateExtra })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { posts, fetchMock }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <MusicPage />
          </ConfirmProvider>
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

describe('MusicPage duplicate removal', () => {
  it('hides the button when there is nothing duplicated', async () => {
    mockApi({ duplicateExtra: 0 })
    renderPage()
    await screen.findAllByText('Zein')
    expect(screen.queryByRole('button', { name: /مسح المكرر/ })).not.toBeInTheDocument()
  })

  it('shows the button with the number of extra copies', async () => {
    mockApi({ duplicateExtra: 2 })
    renderPage()
    expect(await screen.findByRole('button', { name: 'مسح المكرر (2)' })).toBeInTheDocument()
  })

  it('previews first, asks to confirm with the real numbers, then deletes', async () => {
    const { posts } = mockApi({
      duplicateExtra: 2,
      dryRun: plan({ removeCount: 2, keepCount: 1 }),
      apply: plan({ dryRun: false, removeCount: 2, keepCount: 1, repointedDocs: 3, freedBytes: 5 * 1024 * 1024 }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'مسح المكرر (2)' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('هيتمسح 2 مقطوعة مكررة')
    expect(dialog).toHaveTextContent('(1)')
    expect(posts).toEqual([{ dryRun: true }]) // لسه ماتمسحش حاجة

    fireEvent.click(screen.getByRole('button', { name: 'امسح المكرر' }))
    await waitFor(() => expect(posts).toEqual([{ dryRun: true }, { dryRun: false }]))
    const toast = await screen.findByText(/اتمسح 2 مقطوعة مكررة وفضل 1/)
    expect(toast).toHaveTextContent('وتحوّل 3 مستند')
    expect(toast).toHaveTextContent('5.0 ميجابايت')
  })

  it('does nothing more when the confirmation is cancelled', async () => {
    const { posts } = mockApi({ duplicateExtra: 2 })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'مسح المكرر (2)' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(posts).toEqual([{ dryRun: true }])
  })

  it('explains when the names match but nothing is a real duplicate', async () => {
    const { posts } = mockApi({ duplicateExtra: 2, dryRun: plan({ removeCount: 0, keepCount: 0 }) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'مسح المكرر (2)' }))
    expect(await screen.findByText(/مفيش مقطوعات مكررة فعلاً/)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(posts).toEqual([{ dryRun: true }])
  })

  it('renders each track as a card-capable row with labelled cells', async () => {
    mockApi({ duplicateExtra: 0 })
    renderPage()
    await screen.findAllByText('Zein')
    const table = document.querySelector('.rows-table')!
    expect(table).toHaveClass('table-cards', 'table-cards--lg')
    const row = table.querySelector('tbody tr')!
    expect(row.querySelector('td.cell--title')).not.toBeNull()
    expect(row.querySelector('td.cell--actions')).not.toBeNull()
    const labels = [...row.querySelectorAll('td[data-label]')].map((td) => td.getAttribute('data-label'))
    expect(labels).toEqual(['استماع', 'الترتيب', 'الحالة'])
  })
})
