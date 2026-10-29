import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Rsvp } from './blocks/Rsvp'
import { InviteContext } from './context'
import { rsvpBlock } from './fixtures'
import { makeT } from './strings'

function renderRsvp(block = rsvpBlock(), ctx: { lang?: 'ar' | 'en'; demo?: boolean } = {}) {
  const lang = ctx.lang ?? 'ar'
  return render(
    <InviteContext.Provider value={{ lang, t: makeT(lang), maxWidth: 760, demo: ctx.demo ?? false, hasIntro: false }}>
      <Rsvp block={block} />
    </InviteContext.Provider>,
  )
}

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('Rsvp', () => {
  beforeEach(() => {
    document.cookie = 'csrftoken=tok123'
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the answers as JSON with the CSRF header and shows the success state and pass', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      respond(200, {
        ok: true,
        message: 'شكراً لكم — تم تسجيل ردكم.',
        pass: { code: 'AB12', name: 'منى', entries: 2, url: '/app/i/demo/g/t/pass/', qr: '/q.svg', download: '/q.png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderRsvp(
      rsvpBlock(
        {},
        {
          questions: [
            {
              index: 0,
              name: 'q0',
              label: 'الوجبة',
              kind: 'choice',
              hint: '',
              required: false,
              multiple: false,
              value: '',
              options: [
                { label: 'لحم', checked: false },
                { label: 'سمك', checked: false },
              ],
            },
          ],
        },
      ),
    )
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'منى' } })
    fireEvent.click(screen.getByLabelText('لحم'))
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => expect(screen.getByText('AB12')).toBeInTheDocument())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/invitations/demo/rsvp/')
    expect((init.headers as Record<string, string>)['X-CSRFToken']).toBe('tok123')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ name: 'منى', status: 'attending', lang: 'ar', answers: { q0: 'لحم' } })
    // الزر اتحوّل لنص «تم الإرسال» والحقول اتقفلت
    expect(screen.getByRole('button', { name: 'تم الإرسال ✓' })).toBeDisabled()
    expect((document.querySelector('input[name="name"]') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('تصريح دخولك')).toBeInTheDocument()
    expect(screen.getByText('يكفي 2 أشخاص — وريّه على الباب.')).toBeInTheDocument()
  })

  it('shows the server error and re-enables the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        respond(429, { error: { code: 'rate_limited', message: 'عدد كبير من المحاولات.' } }),
      ),
    )
    renderRsvp()
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'منى' } })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('عدد كبير من المحاولات.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'إرسال التأكيد' })).toBeEnabled()
  })

  it('does not call the server in a template preview (demo)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderRsvp(rsvpBlock({}, { demo: true, action: '' }), { demo: true })
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'منى' } })
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('معاينة القالب — الرد مش بيتسجّل.')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the closed message after the deadline', () => {
    renderRsvp(rsvpBlock({}, { closed: true }))
    expect(screen.getByText('انتهى الموعد')).toBeInTheDocument()
    expect(document.querySelector('form')).toBeNull()
  })

  it('prefills the guest and limits companions to their allowance', () => {
    renderRsvp(
      rsvpBlock(
        {},
        {
          guest: {
            name: 'ضيف',
            phone: '010',
            token: 'T'.repeat(24),
            maxCompanions: 2,
            answered: { status: 'declined', companions: 1, message: 'قبل كده' },
          },
        },
      ),
    )
    expect(screen.getByText('سجّلنا ردك قبل كده يا ضيف — تقدر تعدّله من هنا.')).toBeInTheDocument()
    expect((document.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('ضيف')
    const companions = document.querySelector('input[name="companions"]') as HTMLInputElement
    expect(companions.max).toBe('2')
    expect(companions.value).toBe('1')
    expect((document.querySelector('input[value="declined"]') as HTMLInputElement).checked).toBe(true)
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('قبل كده')
  })

  it('hides the companions field for a guest with no allowance', () => {
    renderRsvp(
      rsvpBlock({}, { guest: { name: 'ضيف', phone: '', token: 'T'.repeat(24), maxCompanions: 0, answered: null } }),
    )
    expect(document.querySelector('input[name="companions"]')).toBeNull()
  })

  it('renders the English strings for an English invitation', () => {
    renderRsvp(
      rsvpBlock({}, { guest: { name: 'Sam', phone: '', token: 'T'.repeat(24), maxCompanions: 1, answered: null } }),
      { lang: 'en' },
    )
    expect(screen.getByText('Welcome, Sam 🤍')).toBeInTheDocument()
    expect(screen.getByText('(up to 1)')).toBeInTheDocument()
  })
})
