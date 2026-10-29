import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { boot } from '@/app/boot'
import { api } from './client'
import type { ApiUser, Lang, SiteInfo, TemplatesResponse } from './types'

export const keys = {
  me: ['me'] as const,
  site: ['site'] as const,
  templates: (category?: string) => ['templates', category ?? ''] as const,
}

/** المستخدم الحالي — البداية من الـshell فمفيش طلب قبل أول رسم. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => (await api<{ user: ApiUser | null }>('/me/')).user,
    initialData: boot.site ? boot.user : undefined,
    staleTime: Infinity,
  })
}

export function useSite() {
  return useQuery({
    queryKey: keys.site,
    queryFn: () => api<SiteInfo>('/site/'),
    initialData: boot.site ?? undefined,
    staleTime: 5 * 60_000,
  })
}

export function useTemplates(category?: string) {
  return useQuery({
    queryKey: keys.templates(category),
    queryFn: () => api<TemplatesResponse>('/templates/', { query: { category } }),
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api<{ user: ApiUser }>('/auth/login/', { method: 'POST', body: credentials }),
    onSuccess: ({ user }) => qc.setQueryData(keys.me, user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ user: null }>('/auth/logout/', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(keys.me, null)
      // أي بيانات خاصة بالمستخدم المسجّل لازم تتمسح
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'site' })
    },
  })
}

export function useSetLanguage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (language: Lang) =>
      api<{ language: Lang }>('/language/', { method: 'POST', body: { language } }),
    // المحتوى القادم من السيرفر (أسماء القوالب مثلاً) بيتغيّر بتغيّر اللغة
    onSuccess: () => qc.invalidateQueries(),
  })
}
