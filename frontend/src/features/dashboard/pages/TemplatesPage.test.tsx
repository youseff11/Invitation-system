import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import { ConfirmProvider } from '../ui/ConfirmDialog'
import { ToastProvider } from '../ui/Toast'
import { TemplatesPage } from './TemplatesPage'

const row = (id: number, name: string, isActive: boolean) => ({
  id,
  slug: `t-${id}`,
  name,
  category: 'none',
  categoryLabel: '',
  source: 'builtin',
  sourceLabel: '',
  blocks: 3,
  uses: 1,
  isActive,
  cover: null,
  editorUrl: `/dashboard/templates/${id}/editor/`,
  adminUrl: '#',
  previewUrl: '#',
})

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

beforeAll(() => initI18n('ar'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TemplatesPage visibility filter', () => {
  it('shows all, only visible or only hidden templates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/dashboard/templates/')) {
          return json({ categories: [], results: [row(1, 'ظاهر-١', true), row(2, 'مخفي-٢', false), row(3, 'ظاهر-٣', true)] })
        }
        return json({ name: { ar: 'x', en: 'x' } })
      }),
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ToastProvider>
            <ConfirmProvider>
              <TemplatesPage />
            </ConfirmProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const filter = await screen.findByLabelText('عرض القوالب')
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['ظاهر-١', 'مخفي-٢', 'ظاهر-٣']),
    )
    expect(screen.getByRole('option', { name: 'الظاهر (2)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'المخفي (1)' })).toBeInTheDocument()

    fireEvent.change(filter, { target: { value: 'hidden' } })
    expect(screen.queryByText('ظاهر-١')).toBeNull()
    expect(screen.getByText('مخفي-٢')).toBeInTheDocument()

    fireEvent.change(filter, { target: { value: 'visible' } })
    expect(screen.queryByText('مخفي-٢')).toBeNull()
    expect(screen.getByText('ظاهر-١')).toBeInTheDocument()
    expect(screen.getByText('ظاهر-٣')).toBeInTheDocument()
  })
})
