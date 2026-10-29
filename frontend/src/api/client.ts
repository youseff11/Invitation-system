/**
 * عميل واجهة ‎/api/v1/‎.
 *
 * - نفس الأصل (same-origin) فالكوكيز بتتبعت لوحدها.
 * - أي طلب غير GET بيحمل ‎X-CSRFToken‎ من كوكي ‎csrftoken‎ (Django بيزرعه من
 *   صفحة الـshell، ولو مش موجود بنطلبه من ‎/csrf/‎ قبل الإرسال).
 * - أي فشل بيتحوّل لـ ‎ApiError‎ — حتى لو السيرفر رجّع HTML (404 مثلاً).
 */

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export function getCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Query): string {
  const url = BASE + path
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function csrfToken(): Promise<string> {
  const existing = getCookie('csrftoken')
  if (existing) return existing
  const res = await fetch(`${BASE}/csrf/`, { credentials: 'same-origin' })
  const data = (await res.json()) as { csrfToken: string }
  return getCookie('csrftoken') ?? data.csrfToken
}

async function toApiError(res: Response): Promise<ApiError> {
  const isJson = res.headers.get('content-type')?.includes('application/json')
  if (isJson) {
    try {
      const body = await res.json()
      const err = body?.error
      if (err) return new ApiError(res.status, err.code ?? 'error', err.message ?? '', err.fields)
    } catch {
      /* جسم JSON تالف — نكمّل بالخطأ العام */
    }
  }
  return new ApiError(res.status, 'http_error', res.statusText || `HTTP ${res.status}`)
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined

  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  if (method !== 'GET') headers['X-CSRFToken'] = await csrfToken()

  const res = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal,
  })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
