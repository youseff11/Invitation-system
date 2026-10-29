import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'

import { api } from '@/api/client'

import type { CatalogApp, DeletePreview, FieldValue, ListResponse, ObjectResponse, Ref, SchemaResponse, Values } from './types'

export const dataKeys = {
  all: ['data'] as const,
  catalog: ['data', 'catalog'] as const,
  list: (key: string, params: Record<string, string>) => ['data', key, 'list', params] as const,
  schema: (key: string) => ['data', key, 'schema'] as const,
  object: (key: string, id: string) => ['data', key, 'object', id] as const,
}

export const catalogQuery = () =>
  queryOptions({ queryKey: dataKeys.catalog, queryFn: () => api<{ apps: CatalogApp[] }>('/data/') })

export const useCatalog = () => useQuery(catalogQuery())

export const useDataList = (key: string, params: Record<string, string>) =>
  useQuery({
    queryKey: dataKeys.list(key, params),
    queryFn: () => api<ListResponse>(`/data/${key}/`, { query: params }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  })

export const useDataSchema = (key: string) =>
  useQuery({ queryKey: dataKeys.schema(key), queryFn: () => api<SchemaResponse>(`/data/${key}/schema/`), staleTime: 60_000 })

export const useDataObject = (key: string, id: string, enabled: boolean) =>
  useQuery({
    queryKey: dataKeys.object(key, id),
    queryFn: () => api<ObjectResponse>(`/data/${key}/${id}/`),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })

export const lookup = (key: string, field: string, q: string, signal?: AbortSignal) =>
  api<{ results: Ref[] }>(`/data/${key}/lookup/${field}/`, { query: { q }, signal })

/** القيم المتغيّرة بس + الملفات (multipart لو فيه ملف) → ‎{id, title}‎. */
export function saveObject(key: string, id: string | null, values: Values, files: Record<string, File>) {
  const path = id ? `/data/${key}/${id}/` : `/data/${key}/`
  const payload: Record<string, FieldValue> = { ...values }
  if (Object.keys(files).length === 0) return api<{ id: number; title: string }>(path, { method: 'POST', body: payload })
  const form = new FormData()
  form.set('payload', JSON.stringify(payload))
  for (const [name, file] of Object.entries(files)) form.set(name, file)
  return api<{ id: number; title: string }>(path, { method: 'POST', body: form })
}

export const previewDelete = (key: string, ids: number[]) =>
  api<DeletePreview>(`/data/${key}/delete-preview/`, { method: 'POST', body: { ids } })

export const deleteObjects = (key: string, ids: number[]) =>
  api<{ deleted: number }>(`/data/${key}/delete/`, { method: 'POST', body: { ids } })

export const setUserPassword = (id: string, password1: string, password2: string) =>
  api<{ ok: boolean }>(`/data/auth.user/${id}/password/`, { method: 'POST', body: { password1, password2 } })
