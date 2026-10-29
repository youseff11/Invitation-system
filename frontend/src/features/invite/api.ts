import { api } from '@/api/client'

import type { InviteLang, RenderPayload } from './types'

/** المصدر اللي بيتجاب منه المحتوى: دعوة (وممكن رمز ضيف) أو معاينة قالب. */
export interface Source {
  kind: 'invitation' | 'template'
  slug: string
  guestToken?: string
}

/** مستند الدعوة بلغة معيّنة — بيستخدمه تبديل اللغة وفتح كلمة السر. */
export function fetchRender(source: Source, lang: InviteLang | ''): Promise<RenderPayload> {
  if (source.kind === 'template') {
    return api<RenderPayload>(`/templates/${encodeURIComponent(source.slug)}/preview/`, {
      query: { lang },
    })
  }
  return api<RenderPayload>(`/invitations/${encodeURIComponent(source.slug)}/render/`, {
    query: { lang, guest: source.guestToken },
  })
}

export function unlockInvitation(slug: string, password: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/invitations/${encodeURIComponent(slug)}/unlock/`, {
    method: 'POST',
    body: { password },
  })
}
