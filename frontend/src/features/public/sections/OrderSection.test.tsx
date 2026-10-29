import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SiteInfo } from '@/api/types'
import { initI18n } from '@/i18n'
import type { OrderFormOptions } from '../types'
import { OrderSection } from './OrderSection'

const SITE = { ordersEnabled: true, currency: 'ج.م' } as SiteInfo

const OPTIONS: OrderFormOptions = {
  templates: [{ id: 1, name: 'ذهبي', nameEn: 'Golden' }],
  plans: [
    { id: 1, name: 'الأساسية', nameEn: 'Essential', price: 750 },
    { id: 2, name: 'الملكية', nameEn: 'Royal', price: 2600 },
  ],
  addons: [
    { id: 10, name: 'موسيقى', nameEn: 'Music', price: 200, description: '', planIds: [2] },
    { id: 11, name: 'تسليم سريع', nameEn: 'Rush', price: 100, description: '', planIds: [] },
  ],
  defaultEventType: 'زفاف',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn<typeof fetch>()
let orderResponse: () => Response

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrderSection site={SITE} />
    </QueryClientProvider>,
  )
}

const submitButton = () => screen.getByRole('button', { name: 'إرسال الطلب' })
const orderBody = () => {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/orders/'))
  return JSON.parse(String(call?.[1]?.body))
}

describe('OrderSection', () => {
  beforeAll(() => {
    initI18n('ar')
  })

  beforeEach(() => {
    document.cookie = 'csrftoken=tok'
    orderResponse = () => json({ received: true, message: 'ok' }, 201)
    fetchMock.mockImplementation(async (url) => {
      const path = String(url)
      if (path.includes('/public/order-form/')) return json(OPTIONS)
      if (path.endsWith('/orders/')) return orderResponse()
      throw new Error(`unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('hides add-ons tied to other plans, totals the visible ones and posts the order', async () => {
    renderForm()
    await screen.findByRole('option', { name: 'الملكية' })

    // «موسيقى» مربوطة بالملكية بس؛ «تسليم سريع» متاحة مع الكل
    expect(screen.queryByRole('checkbox', { name: /موسيقى/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /تسليم سريع/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('الباقة'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /موسيقى/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /تسليم سريع/ }))
    expect(screen.getByText('إجمالي الإضافات: +300 ج.م')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'أحمد علي' } })
    fireEvent.change(screen.getByLabelText('رقم واتساب'), { target: { value: '01012345678' } })
    fireEvent.submit(submitButton().closest('form')!)

    expect(await screen.findByText(/تم استلام طلبك/)).toBeInTheDocument()
    expect(orderBody()).toMatchObject({
      customerName: 'أحمد علي',
      customerPhone: '01012345678',
      plan: 2,
      template: null,
      eventType: 'زفاف',
      addons: [10, 11],
    })
  })

  it('drops a chosen add-on when the plan changes to one it does not belong to', async () => {
    renderForm()
    await screen.findByRole('option', { name: 'الملكية' })

    fireEvent.change(screen.getByLabelText('الباقة'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /موسيقى/ }))
    fireEvent.change(screen.getByLabelText('الباقة'), { target: { value: '1' } })
    expect(screen.queryByRole('checkbox', { name: /موسيقى/ })).not.toBeInTheDocument()

    fireEvent.submit(submitButton().closest('form')!)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/orders/'))).toBe(true))
    expect(orderBody().addons).toEqual([])
  })

  it('shows the server validation errors next to the fields', async () => {
    orderResponse = () =>
      json(
        { error: { code: 'invalid_order', message: 'x', fields: { customerPhone: 'هذا الحقل مطلوب.' } } },
        400,
      )
    renderForm()
    await screen.findByRole('option', { name: 'الملكية' })

    fireEvent.submit(submitButton().closest('form')!)

    expect(await screen.findByText('يرجى مراجعة البيانات المدخلة.')).toBeInTheDocument()
    expect(screen.getByText('هذا الحقل مطلوب.')).toBeInTheDocument()
  })
})
