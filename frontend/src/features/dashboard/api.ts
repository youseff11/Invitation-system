import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type {
  AddonBody,
  AddonRow,
  AnalyticsResponse,
  ClipRow,
  FontRow,
  InvitationCreateBody,
  InvitationCustomerBody,
  InvitationFilters,
  InvitationOptions,
  InvitationsResponse,
  OrdersResponse,
  OverviewResponse,
  PlanQuickBody,
  PlanRow,
  PlansResponse,
  SiteResponse,
  SiteValues,
  TemplateImportResult,
  TemplatesResponse,
  TrackRow,
  DedupeResult,
} from './types'

/** كل استعلامات اللوحة تحت ‎['dashboard']‎ — أي تعديل بيبطّلها كلها (البيانات صغيرة وشغّالة على نفس القاعدة). */
const ROOT = ['dashboard'] as const

export const dashKeys = {
  overview: [...ROOT, 'overview'] as const,
  analytics: [...ROOT, 'analytics'] as const,
  orders: (status: string) => [...ROOT, 'orders', status] as const,
  invitations: (filters: InvitationFilters) => [...ROOT, 'invitations', filters] as const,
  invitationOptions: [...ROOT, 'invitation-options'] as const,
  templates: [...ROOT, 'templates'] as const,
  library: (kind: LibraryKind) => [...ROOT, 'library', kind] as const,
  plans: [...ROOT, 'plans'] as const,
  site: [...ROOT, 'site'] as const,
}

function useInvalidatingMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  alsoInvalidate: readonly unknown[][] = [],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ROOT }),
        ...alsoInvalidate.map((queryKey) => qc.invalidateQueries({ queryKey })),
      ])
    },
  })
}

// ---------------------------------------------------------------- القراءة
/** خيارات كل استعلام قراءة — بيستخدمها الـhook والجلب المسبق (‎prefetch.ts‎) بنفس المفتاح بالظبط. */
export const dashQueries = {
  overview: () => queryOptions({ queryKey: dashKeys.overview, queryFn: () => api<OverviewResponse>('/dashboard/overview/') }),
  analytics: () => queryOptions({ queryKey: dashKeys.analytics, queryFn: () => api<AnalyticsResponse>('/dashboard/analytics/') }),
  orders: (status: string) =>
    queryOptions({
      queryKey: dashKeys.orders(status),
      queryFn: () => api<OrdersResponse>('/dashboard/orders/', { query: { status } }),
    }),
  invitations: (filters: InvitationFilters) =>
    queryOptions({
      queryKey: dashKeys.invitations(filters),
      queryFn: () => api<InvitationsResponse>('/dashboard/invitations/', { query: { ...filters } }),
    }),
  templates: () => queryOptions({ queryKey: dashKeys.templates, queryFn: () => api<TemplatesResponse>('/dashboard/templates/') }),
  plans: () => queryOptions({ queryKey: dashKeys.plans, queryFn: () => api<PlansResponse>('/dashboard/plans/') }),
  site: () => queryOptions({ queryKey: dashKeys.site, queryFn: () => api<SiteResponse>('/dashboard/site/') }),
  library: <K extends LibraryKind>(kind: K) =>
    queryOptions({
      queryKey: dashKeys.library(kind),
      // ‎duplicateExtra‎: تلميح بعدد النسخ الزيادة بالاسم (مكتبة الموسيقى بس)
      queryFn: () => api<{ results: LibraryRows[K][]; duplicateExtra?: number }>(`/dashboard/${kind}/`),
    }),
}

export function useOverview() {
  return useQuery(dashQueries.overview())
}

export function useAnalytics() {
  return useQuery(dashQueries.analytics())
}

export function useOrders(status: string) {
  return useQuery({ ...dashQueries.orders(status), placeholderData: keepPreviousData })
}

export function useInvitations(filters: InvitationFilters) {
  return useQuery({ ...dashQueries.invitations(filters), placeholderData: keepPreviousData })
}

export function useInvitationOptions() {
  return useQuery({
    queryKey: dashKeys.invitationOptions,
    queryFn: () => api<InvitationOptions>('/dashboard/invitations/options/'),
  })
}

export function useTemplatesList() {
  return useQuery(dashQueries.templates())
}

export function usePlans() {
  return useQuery(dashQueries.plans())
}

export function useSiteSettings() {
  return useQuery(dashQueries.site())
}

// ---------------------------------------------------------------- الدعوات
export function useDuplicateInvitation() {
  return useInvalidatingMutation((id: number) =>
    api<{ id: number; title: string; sourceTitle: string }>(`/dashboard/invitations/${id}/duplicate/`, {
      method: 'POST',
    }),
  )
}

export function useChangeInvitationCustomer() {
  return useInvalidatingMutation((vars: { id: number; body: InvitationCustomerBody }) =>
    api<{ id: number; customerId: number; customerName: string }>(`/dashboard/invitations/${vars.id}/customer/`, {
      method: 'POST',
      body: vars.body,
    }),
  )
}

export function useDeleteInvitation() {
  return useInvalidatingMutation((id: number) =>
    api<{ deleted: boolean; title: string }>(`/dashboard/invitations/${id}/`, { method: 'DELETE' }),
  )
}

export function useCreateInvitation() {
  return useInvalidatingMutation((body: InvitationCreateBody) =>
    api<{ id: number; editorUrl: string }>('/dashboard/invitations/', { method: 'POST', body }),
  )
}

// ---------------------------------------------------------------- القوالب
export function useToggleTemplate() {
  return useInvalidatingMutation((id: number) =>
    api<{ id: number; name: string; isActive: boolean }>(`/dashboard/templates/${id}/toggle/`, {
      method: 'POST',
    }),
  )
}

export function useDeleteTemplate() {
  return useInvalidatingMutation((id: number) =>
    api<{ deleted: boolean; name: string }>(`/dashboard/templates/${id}/`, { method: 'DELETE' }),
  )
}

export function useCreateTemplate() {
  return useInvalidatingMutation((body: FormData) =>
    api<{ id: number; name: string; editorUrl: string }>('/dashboard/templates/', {
      method: 'POST',
      body,
    }),
  )
}

export function useImportTemplate() {
  return useInvalidatingMutation((body: FormData) =>
    api<TemplateImportResult>('/dashboard/templates/import/', { method: 'POST', body }),
  )
}

// ---------------------------------------------------------------- المكتبات (خطوط / موسيقى / افتتاحيات)
export type LibraryKind = 'fonts' | 'music' | 'intros' | 'videos'

interface LibraryRows {
  fonts: FontRow
  music: TrackRow
  intros: ClipRow
  videos: ClipRow
}

export function useLibrary<K extends LibraryKind>(kind: K) {
  const path = `/dashboard/${kind}/`
  type Row = LibraryRows[K]
  const list = useQuery(dashQueries.library(kind))
  const create = useInvalidatingMutation((body: FormData) => api<Row>(path, { method: 'POST', body }))
  const toggle = useInvalidatingMutation((id: number) =>
    api<Row>(`${path}${id}/toggle/`, { method: 'POST' }),
  )
  const remove = useInvalidatingMutation((id: number) =>
    api<{ deleted: boolean; name: string }>(`${path}${id}/`, { method: 'DELETE' }),
  )
  // إعادة التسمية (الافتتاحيات والفيديوهات) والنقل من الفيديوهات للافتتاحيات
  const rename = useInvalidatingMutation(({ id, name }: { id: number; name: string }) =>
    api<Row>(`${path}${id}/`, { method: 'PATCH', body: { name } }),
  )
  const moveToIntros = useInvalidatingMutation((id: number) =>
    api<Row>(`${path}${id}/move/`, { method: 'POST' }),
  )
  return { list, create, toggle, remove, rename, moveToIntros }
}

/** مسح المقطوعات المكررة: ‎dryRun=true‎ بيرجّع الخطة من غير تغيير، وبعده التنفيذ الفعلي. */
export function useDedupeMusic() {
  return useInvalidatingMutation((dryRun: boolean) =>
    api<DedupeResult>('/dashboard/music/dedupe/', { method: 'POST', body: { dryRun } }),
  )
}

// ---------------------------------------------------------------- الباقات والإضافات
export function useSavePlan() {
  return useInvalidatingMutation(({ id, body }: { id: number; body: PlanQuickBody }) =>
    api<PlanRow>(`/dashboard/plans/${id}/`, { method: 'PATCH', body }),
  )
}

export function useSaveAddon() {
  return useInvalidatingMutation(({ id, body }: { id: number | null; body: AddonBody }) =>
    id === null
      ? api<AddonRow>('/dashboard/addons/', { method: 'POST', body })
      : api<AddonRow>(`/dashboard/addons/${id}/`, { method: 'PATCH', body }),
  )
}

export function useToggleAddon() {
  return useInvalidatingMutation((id: number) =>
    api<AddonRow>(`/dashboard/addons/${id}/toggle/`, { method: 'POST' }),
  )
}

export function useDeleteAddon() {
  return useInvalidatingMutation((id: number) =>
    api<{ deleted: boolean; deactivated: boolean; name: string }>(`/dashboard/addons/${id}/`, {
      method: 'DELETE',
    }),
  )
}

// ---------------------------------------------------------------- إعدادات الموقع
export function useSaveSiteSettings() {
  // الإعدادات العامة (شريط الواتساب والروابط…) بتتقرا من ‎['site']‎ كمان — نبطّلها
  return useInvalidatingMutation(
    (body: SiteValues) => api<SiteResponse>('/dashboard/site/', { method: 'PUT', body }),
    [['site']],
  )
}
