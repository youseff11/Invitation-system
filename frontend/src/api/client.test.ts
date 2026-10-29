import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, getCookie } from './client'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    document.cookie = 'csrftoken=tok123'
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('reads cookies', () => {
    expect(getCookie('csrftoken')).toBe('tok123')
    expect(getCookie('missing')).toBeNull()
  })

  it('builds the query string and skips empty values', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: 1 }))
    await api('/templates/', { query: { category: 'wedding', page: 2, empty: '', none: undefined } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/templates/?category=wedding&page=2')
  })

  it('sends no CSRF header on GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await api('/me/')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-CSRFToken']).toBeUndefined()
  })

  it('sends the CSRF header and JSON body on POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: null }))
    await api('/auth/logout/', { method: 'POST', body: { a: 1 } })
    const init = fetchMock.mock.calls[0][1]!
    const headers = init.headers as Record<string, string>
    expect(headers['X-CSRFToken']).toBe('tok123')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
    expect(init.credentials).toBe('same-origin')
  })

  it('fetches a CSRF token first when the cookie is missing', async () => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    fetchMock
      .mockImplementationOnce(async () => {
        document.cookie = 'csrftoken=fresh'
        return jsonResponse({ csrfToken: 'fresh' })
      })
      .mockResolvedValueOnce(jsonResponse({}))
    await api('/language/', { method: 'POST', body: { language: 'en' } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/csrf/')
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(headers['X-CSRFToken']).toBe('fresh')
  })

  it('maps API errors to ApiError with code and fields', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'missing_credentials', message: 'مطلوب', fields: { username: 'مطلوب' } } },
        { status: 400 },
      ),
    )
    const error = await api('/auth/login/', { method: 'POST', body: {} }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'missing_credentials', fields: { username: 'مطلوب' } })
  })

  it('maps non-JSON error pages (Django HTML 404) to a generic ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response('<h1>Not Found</h1>', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const error = await api('/nope/').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: 'http_error' })
  })

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await api('/x/', { method: 'DELETE' })).toBeUndefined()
  })
})
