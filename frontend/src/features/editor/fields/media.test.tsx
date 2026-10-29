import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import * as api from '../assets/api'
import { asset, boot, mount } from '../assets/testkit'
import { resetEditor, useEditor } from '../store'
import type { FieldSpec } from '../types'
import { FieldRenderer } from './registry'
import './index'

vi.mock('../assets/api', async (original) => ({
  ...(await original<typeof import('../assets/api')>()),
  cropAsset: vi.fn(),
  uploadFont: vi.fn(),
  fetchAssets: vi.fn(),
}))
const cropAsset = vi.mocked(api.cropAsset)
const uploadFont = vi.mocked(api.uploadFont)

const spec = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'type'>): FieldSpec => ({
  label: over.key,
  default: '',
  group: 'المحتوى',
  ...over,
})
const imageSpec = spec({ key: 'bg_image', type: 'image', label: 'صورة الخلفية' })
const s = () => useEditor.getState()

const withImages = () =>
  s().load(
    boot({
      assets: [
        asset(1, { name: 'عروسة.png' }),
        asset(2, { name: 'قاعة.png' }),
        asset(3, { kind: 'video', url: '/media/assets/2026/01/000000000003/v.mp4', thumb: '/media/assets/2026/01/000000000003/f.jpg' }),
      ],
      music: [{ id: 1, name: 'نغمة الفرح', url: '/media/music/farah.mp3', note: '' }],
    }),
  )

beforeAll(() => initI18n('ar'))
beforeEach(() => {
  resetEditor()
  vi.clearAllMocks()
  withImages()
})
afterEach(() => vi.restoreAllMocks())

describe('image field', () => {
  it('shows a preview of the current image next to its link', () => {
    mount(<FieldRenderer spec={imageSpec} value="/media/x.webp" onChange={() => {}} />)
    expect((document.querySelector('.ed-image-thumb') as HTMLElement).style.backgroundImage).toContain('/media/x.webp')
    expect(screen.getByLabelText('صورة الخلفية')).toHaveValue('/media/x.webp')
  })

  it('lets you paste a link', () => {
    const onChange = vi.fn()
    mount(<FieldRenderer spec={imageSpec} value="" onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('أو الصق رابط صورة'), { target: { value: 'https://x.test/a.png' } })
    expect(onChange).toHaveBeenCalledWith('https://x.test/a.png')
  })

  it('opens the library from the button and from the thumbnail, and takes the picked image', () => {
    const onChange = vi.fn()
    mount(<FieldRenderer spec={imageSpec} value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'اختر أو ارفع صورة', hidden: false }))
    expect(screen.getByRole('dialog', { name: 'مكتبة الصور' })).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('قاعة.png'))
    expect(onChange).toHaveBeenCalledWith(asset(2).url)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(document.querySelector('.ed-image-thumb') as HTMLElement, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'مكتبة الصور' })).toBeInTheDocument()
  })

  it('crop needs an image from the library first', () => {
    mount(<FieldRenderer spec={imageSpec} value="https://elsewhere.test/a.png" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'قصّ الصورة' }))
    expect(screen.getByRole('alert')).toHaveTextContent('اختر صورة من المكتبة الأول')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('crops a library image from its original and uses the cropped copy', async () => {
    const cropped = asset(8, { url: '/media/assets/2026/01/000000000008/c.webp' })
    cropAsset.mockResolvedValue({ asset: cropped })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = this.classList.contains('ed-crop-stage') ? [0, 0, 400, 300] : this.tagName === 'IMG' ? [50, 20, 300, 200] : [0, 0, 0, 0]
      const [left, top, width, height] = box
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
    })
    const onChange = vi.fn()
    mount(<FieldRenderer spec={imageSpec} value={asset(1).url} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'قصّ الصورة' }))
    const dialog = screen.getByRole('dialog', { name: 'قصّ الصورة' })
    expect(within(dialog).getByAltText('عروسة.png')).toHaveAttribute('src', asset(1).source)
    fireEvent.load(within(dialog).getByAltText('عروسة.png'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'اقصّ' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(cropped.url))
    expect(cropAsset.mock.calls[0].slice(0, 3)).toEqual(['invitation', 7, 1])
    expect(s().lib.assets[0].id).toBe(8)
  })

  it('a failed crop leaves the field untouched', async () => {
    cropAsset.mockRejectedValue(new ApiError(404, 'not_found', 'الصورة غير موجودة.'))
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const onChange = vi.fn()
    mount(<FieldRenderer spec={imageSpec} value={asset(1).url} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'قصّ الصورة' }))
    fireEvent.load(screen.getByAltText('عروسة.png'))
    fireEvent.click(screen.getByRole('button', { name: 'اقصّ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('الصورة غير موجودة.')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('media field', () => {
  it('audio: no crop button, offers the music library and takes the picked track', () => {
    const onChange = vi.fn()
    const audio = spec({ key: 'music_url', type: 'media', media_kind: 'audio', label: 'رابط الموسيقى' })
    mount(<FieldRenderer spec={audio} value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'قصّ الصورة' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'اختر أو ارفع ملف' }))
    expect(screen.getByRole('dialog', { name: 'مكتبة الموسيقى' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'نغمة الفرح' }))
    expect(onChange).toHaveBeenCalledWith('/media/music/farah.mp3')
  })

  it('video: shows the saved frame of the current library video', () => {
    const video = spec({ key: 'video_url', type: 'media', media_kind: 'video', label: 'فيديو' })
    mount(<FieldRenderer spec={video} value="/media/assets/2026/01/000000000003/v.mp4" onChange={() => {}} />)
    expect((document.querySelector('.ed-image-thumb') as HTMLElement).style.backgroundImage).toContain('f.jpg')
  })
})

describe('intro video field', () => {
  const intro = spec({ key: 'intro_video', type: 'media', media_kind: 'video', label: 'فيديو الافتتاحية' })
  const apply = (value: unknown) => s().setSetting('intro_video', value)

  it('picking a library video also sets the intro poster, in a single undo step', () => {
    mount(<FieldRenderer spec={intro} value="" onChange={apply} />)
    const before = s().history.length
    fireEvent.click(screen.getByRole('button', { name: 'اختر أو ارفع فيديو' }))
    fireEvent.click(screen.getByRole('button', { name: /رفع من جهازك/ }))
    fireEvent.click(screen.getByTitle('a3.png'))

    expect(s().doc.settings).toMatchObject({
      intro_video: '/media/assets/2026/01/000000000003/v.mp4',
      intro_poster: '/media/assets/2026/01/000000000003/f.jpg',
    })
    expect(s().history.length).toBe(before + 1)
    s().undo()
    expect(s().doc.settings.intro_video).toBeUndefined()
    expect(s().doc.settings.intro_poster).toBeUndefined()
  })

  it('typing a different link clears the old poster', () => {
    s().commit((d) => ({ ...d, settings: { ...d.settings, intro_video: '/a.mp4', intro_poster: '/a.jpg' } }))
    mount(<FieldRenderer spec={intro} value="/a.mp4" onChange={apply} />)
    fireEvent.change(screen.getByPlaceholderText('أو الصق رابط الملف'), { target: { value: '/b.mp4' } })
    expect(s().doc.settings).toMatchObject({ intro_video: '/b.mp4', intro_poster: '' })
  })

  it('shows the poster as the preview', () => {
    s().commit((d) => ({ ...d, settings: { ...d.settings, intro_video: '/a.mp4', intro_poster: '/a.jpg' } }))
    mount(<FieldRenderer spec={intro} value="/a.mp4" onChange={apply} />)
    expect((document.querySelector('.ed-image-thumb') as HTMLElement).style.backgroundImage).toContain('/a.jpg')
  })

  it('other video fields never touch the intro poster', () => {
    const other = spec({ key: 'video_url', type: 'media', media_kind: 'video' })
    const onChange = vi.fn()
    mount(<FieldRenderer spec={other} value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'اختر أو ارفع فيديو' }))
    fireEvent.click(screen.getByRole('button', { name: /رفع من جهازك/ }))
    fireEvent.click(screen.getByTitle('a3.png'))
    expect(onChange).toHaveBeenCalled()
    expect(s().doc.settings.intro_poster).toBeUndefined()
  })
})

describe('font field', () => {
  const font = spec({ key: 'font', type: 'font', label: 'الخط', options: [{ value: 'Cairo', label: 'Cairo' }] })
  const newFont = { id: 4, name: 'خط الفرح', nameEn: '', label: 'خط الفرح', value: "'Farah Sans', sans-serif", family: 'Farah Sans', url: '/media/fonts/f.woff2', weight: 400, style: 'normal' }
  const upload = (file: File) => fireEvent.change(screen.getByTestId('font-file-input'), { target: { files: [file] } })

  it('uploads a font file, adds it to the library and applies it to the field', async () => {
    uploadFont.mockResolvedValue({ font: newFont })
    const onChange = vi.fn()
    mount(<FieldRenderer spec={font} value="" onChange={onChange} />)
    upload(new File(['x'], 'farah.woff2'))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(newFont.value))
    expect(s().lib.fonts).toEqual([newFont])
    expect(await screen.findByText('اتضاف الخط للمكتبة واتطبق على النص.')).toBeInTheDocument()
  })

  it('lists fonts that were uploaded earlier in the session', () => {
    s().addFont(newFont)
    mount(<FieldRenderer spec={font} value="" onChange={() => {}} />)
    expect(screen.getByRole('option', { name: /خط الفرح/ })).toBeInTheDocument()
  })

  it('shows what the server did not like about the file', async () => {
    uploadFont.mockRejectedValue(new ApiError(400, 'validation_error', 'راجع البيانات.', { file: 'امتداد الخط المسموح: TTF أو OTF أو WOFF أو WOFF2.' }))
    const onChange = vi.fn()
    mount(<FieldRenderer spec={font} value="" onChange={onChange} />)
    upload(new File(['x'], 'evil.exe'))
    expect(await screen.findByRole('alert')).toHaveTextContent('امتداد الخط المسموح')
    expect(onChange).not.toHaveBeenCalled()
    expect(s().lib.fonts).toEqual([])
  })
})
