import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPreview } from './api'
import type { EditorDocument, EventFields } from './types'

vi.mock('@/api/client', () => ({ api: vi.fn().mockResolvedValue({}) }))
import { api } from '@/api/client'

const call = vi.mocked(api)

const doc: EditorDocument = { version: 1, theme: {}, settings: {}, blocks: [] }
const fields = { nameOne: 'ليلى', slug: 'laila' } as EventFields

beforeEach(() => call.mockClear())

describe('fetchPreview', () => {
  it('sends the unsaved event fields for an invitation', async () => {
    await fetchPreview('invitation', 4, doc, 'ar', undefined, fields)
    expect(call).toHaveBeenCalledWith('/editor/invitations/4/preview/', {
      method: 'POST',
      body: { document: doc, lang: 'ar', fields },
      signal: undefined,
    })
  })

  it('leaves fields out when there are none, and for a template', async () => {
    await fetchPreview('invitation', 4, doc, '', undefined, null)
    expect(call.mock.calls[0][1]?.body).toEqual({ document: doc, lang: '' })

    await fetchPreview('template', 9, doc, '', undefined, fields)
    expect(call.mock.calls[1][0]).toBe('/editor/templates/9/preview/')
    expect(call.mock.calls[1][1]?.body).toEqual({ document: doc, lang: '' })
  })

  it('passes the abort signal through', async () => {
    const controller = new AbortController()
    await fetchPreview('invitation', 1, doc, '', controller.signal)
    expect(call.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})
