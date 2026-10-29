import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import type { VenueMarkResponse, VenueRow, VenueState } from '../types'
import { VenuePage } from './VenuePage'

const TOKEN = 't'.repeat(40)

const row = (over: Partial<VenueRow>): VenueRow => ({
  id: 1,
  name: 'علي',
  code: 'FRH-AAA111',
  group: 'العائلة',
  allowed: 2,
  used: 0,
  left: 2,
  status: 'active',
  checkedIn: false,
  at: '',
  ...over,
})

function state(rows: VenueRow[]): VenueState {
  const arrived = rows.filter((r) => r.checkedIn).length
  return {
    invitation: {
      slug: 'demo',
      title: 'ليلى وأحمد',
      nameOne: 'ليلى',
      nameTwo: 'أحمد',
      venue: 'قاعة الياسمين',
      eventAtLabel: 'الاثنين 2 نوفمبر 2026',
    },
    rows,
    stats: {
      guests: rows.length,
      arrived,
      waiting: rows.length - arrived,
      allowed: rows.reduce((n, r) => n + r.allowed, 0),
      used: rows.reduce((n, r) => n + r.used, 0),
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function renderVenue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/i/demo/venue/${TOKEN}`]}>
        <Routes>
          <Route path="i/:slug/venue/:token" element={<VenuePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VenuePage', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeAll(() => initI18n('ar'))
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    document.cookie = 'csrftoken=tok123'
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  const rows = [
    row({ id: 1, name: 'علي', code: 'FRH-AAA111' }),
    row({ id: 2, name: 'منى', code: 'FRH-BBB222', used: 1, left: 1, checkedIn: true, at: '21:30' }),
    row({ id: 3, name: 'هدى', code: 'FRH-CCC333', allowed: 1, used: 1, left: 0, checkedIn: true, at: '21:40' }),
  ]

  it('loads the live list from the venue token and shows the counters', async () => {
    fetchMock.mockResolvedValue(json(state(rows)))
    renderVenue()
    expect(await screen.findByText('علي')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/venue/demo/${TOKEN}/`)
    expect(screen.getByText('قاعة الياسمين', { exact: false })).toBeInTheDocument()
    const arrived = screen.getByText('دخلوا', { selector: '.venue-stat-label' })
    expect(within(arrived.parentElement!).getByText('2')).toBeInTheDocument()
  })

  it('filters the list by arrival state and by search', async () => {
    fetchMock.mockResolvedValue(json(state(rows)))
    renderVenue()
    await screen.findByText('علي')

    fireEvent.click(screen.getByRole('tab', { name: 'لسه' }))
    expect(screen.getByText('علي')).toBeInTheDocument()
    expect(screen.queryByText('منى')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'الكل' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ccc' } })
    expect(screen.getByText('هدى')).toBeInTheDocument()
    expect(screen.queryByText('علي')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText('مفيش ضيف مطابق.')).toBeInTheDocument()
  })

  it('offers check-in only while entries are left and undo only after one was used', async () => {
    fetchMock.mockResolvedValue(json(state(rows)))
    renderVenue()
    await screen.findByText('علي')
    const card = (name: string) => screen.getByText(name).closest('article') as HTMLElement
    expect(within(card('علي')).getByRole('button', { name: 'دخول' })).toBeInTheDocument()
    expect(within(card('علي')).queryByRole('button', { name: 'تراجع' })).not.toBeInTheDocument()
    expect(within(card('منى')).getByRole('button', { name: 'دخول' })).toBeInTheDocument()
    expect(within(card('منى')).getByRole('button', { name: 'تراجع' })).toBeInTheDocument()
    // التصريح اللي خلص مالوش زر دخول
    expect(within(card('هدى')).queryByRole('button', { name: 'دخول' })).not.toBeInTheDocument()
  })

  it('marks a guest in, then redraws the list from the server answer', async () => {
    const after = [row({ id: 1, name: 'علي', used: 1, left: 1, checkedIn: true, at: '22:00' }), ...rows.slice(1)]
    const marked: VenueMarkResponse = { ...state(after), error: '', guest: after[0] }
    fetchMock.mockImplementation(async (url, init) =>
      String(url).endsWith('/mark/') && init?.method === 'POST' ? json(marked) : json(state(rows)),
    )
    renderVenue()
    await screen.findByText('علي')

    const card = screen.getByText('علي').closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'دخول' }))

    expect(await screen.findByText('✓ علي — 1 من 2')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/mark/'))!
    expect(post[0]).toBe(`/api/v1/venue/demo/${TOKEN}/mark/`)
    expect(JSON.parse(String(post[1]?.body))).toEqual({ guest: 1, action: 'in' })
    expect(((post[1] as RequestInit).headers as Record<string, string>)['X-CSRFToken']).toBe('tok123')
    await waitFor(() => expect(within(card).getByText('دخل 22:00')).toBeInTheDocument())
  })

  it('shows a clear message when the venue link is not valid', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'not_found', message: 'x' } }, 404))
    renderVenue()
    expect(await screen.findByText('رابط القاعة غير صالح.')).toBeInTheDocument()
  })
})
