import { api } from '@/api/client'
import type { Bootstrap, EditorDocument, EditorMode, EditorSchema, EventFields, PreviewPayload, SaveResponse, TranslationRows } from './types'

export interface TemplateForm {
  name: string
  slug: string
  category: string
  collection: string
  description: string
  isActive: boolean
}

const base = (mode: EditorMode, id: number) => `/editor/${mode === 'invitation' ? 'invitations' : 'templates'}/${id}`

export const fetchSchema = () => api<EditorSchema>('/editor/schema/')

export const fetchBootstrap = (mode: EditorMode, id: number) => api<Bootstrap>(`${base(mode, id)}/`)

/** ‎fields‎ (بيانات المناسبة غير المحفوظة) بتتبعت لمحرر الدعوة بس عشان المعاينة تعكسها قبل الحفظ. */
export const fetchPreview = (
  mode: EditorMode,
  id: number,
  document: EditorDocument,
  lang: string,
  signal?: AbortSignal,
  fields?: EventFields | null,
) =>
  api<PreviewPayload>(`${base(mode, id)}/preview/`, {
    method: 'POST',
    body: mode === 'invitation' && fields ? { document, lang, fields } : { document, lang },
    signal,
  })

export const postSave = (mode: EditorMode, id: number, document: EditorDocument, fields: EventFields | null) =>
  api<SaveResponse>(`${base(mode, id)}/save/`, {
    method: 'POST',
    body: mode === 'invitation' ? { document, fields } : { document },
  })

/** صفوف تبويب الترجمة للمستند الحالي (وبيانات المناسبة غير المحفوظة لمحرر الدعوة). */
export const fetchTranslations = (
  mode: EditorMode,
  id: number,
  document: EditorDocument,
  fields?: EventFields | null,
  signal?: AbortSignal,
) =>
  api<TranslationRows>(`${base(mode, id)}/translations/`, {
    method: 'POST',
    body: mode === 'invitation' && fields ? { document, fields } : { document },
    signal,
  })

/** يحوّل تصميم الدعوة الحالي لقالب جديد في المكتبة (محرر الدعوة بس). */
export const postSaveTemplate = (invitationId: number, document: EditorDocument, form: TemplateForm) =>
  api<{ templateId: number; slug: string; name: string }>(`${base('invitation', invitationId)}/save-template/`, {
    method: 'POST',
    body: { document, ...form },
  })
