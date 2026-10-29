import { api, ApiError, getCookie } from '@/api/client'

import type { AssetKind, AssetRow, DocBlock, EditorMode, FavoriteRow, FontRow } from '../types'

/** ‎/api/v1/editor/…‎ — ‎system/api/editor_assets.py‎ */
const library = (mode: EditorMode, id: number) => `/editor/${mode === 'invitation' ? 'invitations' : 'templates'}/${id}/assets`

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export const fetchAssets = (mode: EditorMode, id: number) => api<{ assets: AssetRow[] }>(`${library(mode, id)}/`)

export const cropAsset = (mode: EditorMode, id: number, asset: number, box: CropBox) =>
  api<{ asset: AssetRow }>(`${library(mode, id)}/crop/`, { method: 'POST', body: { asset, box } })

/** الحذف للصور والفيديو بس (زي السيرفر)؛ ‎409‎ لو الأصل مستخدم في مستند. */
export type DeletableKind = Extract<AssetKind, 'image' | 'video'>

export const deleteAsset = (mode: EditorMode, id: number, asset: number, kind: DeletableKind) =>
  api<{ deleted: number }>(`${library(mode, id)}/delete/`, { method: 'POST', body: { asset, kind } })

export const bulkDeleteAssets = (mode: EditorMode, id: number, assets: number[], kind: DeletableKind) =>
  api<{ deleted: number[] }>(`${library(mode, id)}/bulk-delete/`, { method: 'POST', body: { assets, kind } })

// ---------------------------------------------------------------- المفضلة
export const fetchFavorites = () => api<{ favorites: FavoriteRow[] }>('/editor/favorites/')

export const createFavorite = (name: string, block: DocBlock) =>
  api<{ favorite: FavoriteRow }>('/editor/favorites/', { method: 'POST', body: { name, block } })

export const deleteFavorite = (id: number) => api<{ deleted: number }>(`/editor/favorites/${id}/`, { method: 'DELETE' })

// ---------------------------------------------------------------- الخطوط
/** اسم عائلة CSS صالح من اسم الملف (السيرفر بيشترط يبدأ بحرف إنجليزي) — زي ‎uploadedFontFamily‎ القديمة. */
export function fontFamilyFromFile(filename: string): string {
  let stem = filename.replace(/\.[^.]+$/, '')
  stem = stem.replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/^[A-Za-z]/.test(stem)) stem = 'UploadedFont'
  return stem.slice(0, 118) || 'UploadedFont'
}

export function uploadFont(file: File) {
  const form = new FormData()
  form.append('name', (file.name.replace(/\.[^.]+$/, '').trim() || 'خط مرفوع').slice(0, 120))
  form.append('family', fontFamilyFromFile(file.name))
  form.append('file', file)
  return api<{ font: FontRow }>('/editor/fonts/', { method: 'POST', body: form })
}

// ---------------------------------------------------------------- الرفع (بتقدّم)
async function csrfToken(): Promise<string> {
  const existing = getCookie('csrftoken')
  if (existing) return existing
  const res = await fetch('/api/v1/csrf/', { credentials: 'same-origin' })
  const data = (await res.json()) as { csrfToken: string }
  return getCookie('csrftoken') ?? data.csrfToken
}

function toError(xhr: XMLHttpRequest): ApiError {
  try {
    const err = JSON.parse(xhr.responseText)?.error
    if (err) return new ApiError(xhr.status, err.code ?? 'error', err.message ?? '', err.fields)
  } catch {
    /* رد مش JSON (صفحة خطأ من الاستضافة مثلاً) */
  }
  return new ApiError(xhr.status, xhr.status === 413 ? 'payload_too_large' : 'http_error', '')
}

/**
 * رفع ملف للمكتبة. ‎XMLHttpRequest‎ مش ‎fetch‎ عشان ‎upload.onprogress‎ (الفيديو ممكن يوصل ٤٠ ميجا).
 * ‎thumb‎: أول فريم من الفيديو بيتاخد في المتصفح لو السيرفر معندوش ffmpeg.
 */
export async function uploadAsset(
  mode: EditorMode,
  id: number,
  file: File,
  thumb: Blob | null,
  onProgress?: (fraction: number) => void,
): Promise<AssetRow> {
  const token = await csrfToken()
  const form = new FormData()
  form.append('file', file)
  if (thumb) {
    const ext = thumb.type === 'image/png' ? 'png' : 'jpg'
    form.append('thumb', thumb, `${file.name.replace(/\.[^.]+$/, '') || 'video'}-thumb.${ext}`)
  }

  return new Promise<AssetRow>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1${library(mode, id)}/upload/`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRFToken', token)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new ApiError(0, 'network_error', ''))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', ''))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(toError(xhr))
      try {
        resolve((JSON.parse(xhr.responseText) as { asset: AssetRow }).asset)
      } catch {
        reject(new ApiError(xhr.status, 'bad_response', ''))
      }
    }
    xhr.send(form)
  })
}
