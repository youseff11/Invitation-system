import type { TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import i18n, { initI18n } from '@/i18n'

import { errorText } from './errors'

beforeAll(() => initI18n('ar'))
const t = i18n.t.bind(i18n) as TFunction
const text = (error: unknown) => errorText(error, t, 'editorAssets.errors.upload')

describe('errorText', () => {
  it('prefers the field messages over the generic one', () => {
    const error = new ApiError(400, 'validation_error', 'راجع البيانات.', { file: 'امتداد غلط.', family: 'اسم غلط.' })
    expect(text(error)).toBe('امتداد غلط. — اسم غلط.')
  })

  it('drops the form-level message when a field already explains it', () => {
    const error = new ApiError(400, 'validation_error', 'x', { file: 'امتداد غلط.', __all__: 'ارفع ملفاً.' })
    expect(text(error)).toBe('امتداد غلط.')
    expect(text(new ApiError(400, 'validation_error', 'x', { __all__: 'ارفع ملفاً.' }))).toBe('ارفع ملفاً.')
  })

  it('falls back to the server message, then to what the status means, then to the caller text', () => {
    expect(text(new ApiError(409, 'asset_in_use', 'مستخدم.'))).toBe('مستخدم.')
    expect(text(new ApiError(401, 'http_error', ''))).toContain('انتهت جلسة الدخول')
    expect(text(new ApiError(413, 'payload_too_large', ''))).toContain('حجمه كبير')
    expect(text(new ApiError(0, 'network_error', ''))).toContain('تعذّر الاتصال')
    expect(text(new ApiError(500, 'http_error', ''))).toBe('تعذّر رفع الملف.')
    expect(text(new Error('boom'))).toBe('تعذّر رفع الملف.')
  })
})
