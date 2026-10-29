import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import type {
  CheckinInfo,
  ClientFollowup,
  GuestInput,
  GuestPass,
  GuestRow,
  GuestsPage,
  ImportReport,
  QrSheet,
  ScanData,
  VenueMarkResponse,
  VenueState,
} from './types'

export const guestKeys = {
  all: ['guests'] as const,
  page: (invitationId: string) => ['guests', 'page', invitationId] as const,
  qrSheet: (invitationId: string) => ['guests', 'qr-sheet', invitationId] as const,
  checkin: (invitationId: string) => ['guests', 'checkin', invitationId] as const,
  venue: (slug: string, token: string) => ['guests', 'venue', slug, token] as const,
  client: (slug: string, token: string) => ['guests', 'client', slug, token] as const,
  pass: (slug: string, token: string) => ['guests', 'pass', slug, token] as const,
}

/** صفحات الرموز: خطأ الرمز (404) مش هيتصلّح بإعادة المحاولة، والبيانات خاصة فمفيش كاش. */
const PRIVATE = { staleTime: 0, gcTime: 0 } as const

// ---------------------------------------------------------------- لوحة التحكم
export function useGuestsPage(invitationId: string) {
  return useQuery({
    queryKey: guestKeys.page(invitationId),
    queryFn: () => api<GuestsPage>(`/invitations/${invitationId}/guests/`),
    staleTime: 0,
  })
}

/** أي تغيير في الضيوف بيعيد تحميل الكشف (الأعداد والإحصائيات بتتحسب على السيرفر). */
function useInvalidatePage(invitationId: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: guestKeys.page(invitationId) })
}

export function useCreateGuest(invitationId: string) {
  const refresh = useInvalidatePage(invitationId)
  return useMutation({
    mutationFn: (input: GuestInput) =>
      api<{ guest: GuestRow }>(`/invitations/${invitationId}/guests/`, { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useUpdateGuest(invitationId: string) {
  const refresh = useInvalidatePage(invitationId)
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GuestInput }) =>
      api<{ guest: GuestRow }>(`/guests/${id}/`, { method: 'PATCH', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteGuest(invitationId: string) {
  const refresh = useInvalidatePage(invitationId)
  return useMutation({
    mutationFn: (id: number) => api<{ deleted: boolean }>(`/guests/${id}/`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}

export function useToggleCheckin(invitationId: string) {
  const refresh = useInvalidatePage(invitationId)
  return useMutation({
    mutationFn: (id: number) =>
      api<{ checkedIn: boolean }>(`/guests/${id}/toggle-checkin/`, { method: 'POST' }),
    onSuccess: refresh,
  })
}

export function useImportGuests(invitationId: string) {
  const refresh = useInvalidatePage(invitationId)
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('csv_file', file)
      return api<ImportReport>(`/invitations/${invitationId}/guests/import/`, { method: 'POST', body })
    },
    onSuccess: refresh,
  })
}

export function useQrSheet(invitationId: string) {
  return useQuery({
    queryKey: guestKeys.qrSheet(invitationId),
    queryFn: () => api<QrSheet>(`/invitations/${invitationId}/guests/qr-sheet/`),
    ...PRIVATE,
  })
}

export function useCheckinInfo(invitationId: string) {
  return useQuery({
    queryKey: guestKeys.checkin(invitationId),
    queryFn: () => api<CheckinInfo>(`/invitations/${invitationId}/checkin/`),
    ...PRIVATE,
  })
}

export const checkinScan = (invitationId: string, token: string) =>
  api<ScanData>(`/invitations/${invitationId}/checkin/scan/`, { method: 'POST', body: { token } })

// ---------------------------------------------------------------- القاعة
/** الكشف الحيّ: بيتحدّث كل ٨ ثواني وأول ما التاب يرجع (مش وهو في الخلفية — تليفون في الجيب مايستهلكش داتا). */
export const VENUE_POLL_MS = 8000

export function useVenueState(slug: string, token: string) {
  return useQuery({
    queryKey: guestKeys.venue(slug, token),
    queryFn: () => api<VenueState>(`/venue/${slug}/${token}/`),
    refetchInterval: VENUE_POLL_MS,
    refetchOnWindowFocus: true,
    ...PRIVATE,
  })
}

export const venueScan = (slug: string, token: string, code: string) =>
  api<ScanData>(`/venue/${slug}/${token}/scan/`, { method: 'POST', body: { token: code } })

export const venueMark = (slug: string, token: string, guest: number, action: 'in' | 'undo') =>
  api<VenueMarkResponse>(`/venue/${slug}/${token}/mark/`, { method: 'POST', body: { guest, action } })

// ---------------------------------------------------------------- العميل والتصريح
export function useClientFollowup(slug: string, token: string) {
  return useQuery({
    queryKey: guestKeys.client(slug, token),
    queryFn: () => api<ClientFollowup>(`/client/${slug}/${token}/`),
    ...PRIVATE,
  })
}

export function useGuestPass(slug: string, token: string) {
  return useQuery({
    queryKey: guestKeys.pass(slug, token),
    queryFn: () => api<GuestPass>(`/guest-pass/${slug}/${token}/`),
    ...PRIVATE,
  })
}
