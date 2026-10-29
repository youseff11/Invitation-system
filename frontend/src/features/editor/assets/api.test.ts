import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

import { fontFamilyFromFile, uploadAsset } from './api'
import { makeClientVideoThumbnail } from './video'

describe('fontFamilyFromFile', () => {
  it('builds a CSS family the server accepts (starts with a Latin letter, safe characters only)', () => {
    expect(fontFamilyFromFile('Amiri-Regular.ttf')).toBe('Amiri-Regular')
    expect(fontFamilyFromFile('my  font (1).woff2')).toBe('my font 1')
    expect(fontFamilyFromFile('٣٢١.otf')).toBe('UploadedFont')
    expect(fontFamilyFromFile('9lives.ttf')).toBe('UploadedFont')
    expect(fontFamilyFromFile('x'.repeat(300) + '.ttf')).toHaveLength(118)
  })
})

class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: FormData | null = null
  withCredentials = false
  status = 0
  responseText = ''
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: FormData) {
    this.body = body
  }
  reply(status: number, text: string) {
    this.status = status
    this.responseText = text
    this.onload?.()
  }
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  document.cookie = 'csrftoken=tok123'
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
const started = async () => {
  // csrfToken() أسينك — نستنى لحد ما الطلب يتفتح
  await vi.waitFor(() => expect(FakeXhr.last?.body).toBeTruthy())
  return FakeXhr.last
}

describe('uploadAsset', () => {
  it('posts the file (and the video frame) with the CSRF header and reports progress', async () => {
    const progress = vi.fn()
    const frame = new Blob(['jpg'], { type: 'image/jpeg' })
    const promise = uploadAsset('template', 12, file, frame, progress)
    const xhr = await started()

    expect([xhr.method, xhr.url]).toEqual(['POST', '/api/v1/editor/templates/12/assets/upload/'])
    expect(xhr.headers['X-CSRFToken']).toBe('tok123')
    expect(xhr.withCredentials).toBe(true)
    expect((xhr.body!.get('file') as File).name).toBe('clip.mp4')
    expect((xhr.body!.get('thumb') as File).name).toBe('clip-thumb.jpg')

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 })
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 })
    expect(progress).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(0.25)

    xhr.reply(201, JSON.stringify({ asset: { id: 5, kind: 'video' } }))
    await expect(promise).resolves.toMatchObject({ id: 5 })
  })

  it('names a lossless PNG frame -thumb.png', async () => {
    const promise = uploadAsset('template', 12, file, new Blob(['png'], { type: 'image/png' }))
    const xhr = await started()
    expect((xhr.body!.get('thumb') as File).name).toBe('clip-thumb.png')
    xhr.reply(201, JSON.stringify({ asset: { id: 6 } }))
    await promise
  })

  it('uses the invitation route, and sends no thumb field when there is no frame', async () => {
    const promise = uploadAsset('invitation', 3, new File(['x'], 'a.png', { type: 'image/png' }), null)
    const xhr = await started()
    expect(xhr.url).toBe('/api/v1/editor/invitations/3/assets/upload/')
    expect(xhr.body!.has('thumb')).toBe(false)
    xhr.reply(201, JSON.stringify({ asset: { id: 1 } }))
    await promise
  })

  it('turns the API error shape into an ApiError', async () => {
    const promise = uploadAsset('invitation', 3, file, null)
    const xhr = await started()
    xhr.reply(400, JSON.stringify({ error: { code: 'validation_error', message: 'نوع الملف غير مسموح.', fields: { file: 'x' } } }))
    await expect(promise).rejects.toMatchObject({ status: 400, code: 'validation_error', message: 'نوع الملف غير مسموح.', fields: { file: 'x' } })
  })

  it('maps a non-JSON 413 from the host to payload_too_large', async () => {
    const promise = uploadAsset('invitation', 3, file, null)
    const xhr = await started()
    xhr.reply(413, '<html>Request Entity Too Large</html>')
    const error = await promise.catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 413, code: 'payload_too_large' })
  })

  it('maps network failure to status 0', async () => {
    const promise = uploadAsset('invitation', 3, file, null)
    const xhr = await started()
    xhr.onerror?.()
    await expect(promise).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('rejects a success response that is not the expected JSON', async () => {
    const promise = uploadAsset('invitation', 3, file, null)
    const xhr = await started()
    xhr.reply(200, 'oops')
    await expect(promise).rejects.toMatchObject({ code: 'bad_response' })
  })
})

describe('makeClientVideoThumbnail', () => {
  it('only tries for video files', async () => {
    expect(await makeClientVideoThumbnail(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull()
    expect(await makeClientVideoThumbnail(new File(['x'], 'a.bin', { type: '' }))).toBeNull()
  })
})
