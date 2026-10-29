import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import { resetEditor, useEditor } from '../store'
import type { AssetRow } from '../types'
import * as api from './api'
import { AssetLibrary } from './AssetLibrary'
import { answerConfirm } from '../confirmTestUtil'
import { asset, boot, deferred, mount } from './testkit'

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
  bulkDeleteAssets: vi.fn(),
  fetchAssets: vi.fn(),
}))
vi.mock('./video', async (original) => ({
  ...(await original<typeof import('./video')>()),
  makeClientVideoThumbnail: vi.fn(async () => null),
}))

const uploadAsset = vi.mocked(api.uploadAsset)
const deleteAsset = vi.mocked(api.deleteAsset)
const bulkDelete = vi.mocked(api.bulkDeleteAssets)
const fetchAssets = vi.mocked(api.fetchAssets)

const library = () => useEditor.getState().lib.assets
const source = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
const tiles = () => [...document.querySelectorAll<HTMLElement>('.ed-asset-wrap')].map((t) => Number(t.dataset.assetId))

beforeAll(() => initI18n('ar'))
beforeEach(() => {
  resetEditor()
  vi.clearAllMocks()
  useEditor.getState().load(
    boot({
      assets: [
        asset(1),
        asset(2, { used: true }),
        asset(3),
        asset(4, { kind: 'video', thumb: '/media/assets/2026/01/000000000004/poster.jpg', url: '/media/assets/2026/01/000000000004/v.mp4' }),
        asset(5, { kind: 'video', url: '/media/assets/2026/01/000000000005/v.mp4', thumb: '/media/assets/2026/01/000000000005/v.mp4' }),
        asset(6, { kind: 'audio', url: '/media/assets/2026/01/000000000006/s.mp3', thumb: '/media/assets/2026/01/000000000006/s.mp3' }),
      ],
      music: [{ id: 1, name: 'نغمة الفرح', url: '/media/music/farah.mp3', note: '' }],
      intros: [
        { id: 1, name: 'افتتاحية ذهبية', url: '/media/intros/gold.mp4', poster: '/media/intros/gold.jpg', seconds: 4.4, note: '' },
      ],
      videos: [
        { id: 7, name: 'فيديو الحنة', url: '/media/videos/henna.mp4', poster: '', seconds: 12, note: '' },
      ],
    }),
  )
})
afterEach(() => vi.restoreAllMocks())

describe('AssetLibrary — grid', () => {
  it('lists only assets of the requested kind and tells which ones are in use', () => {
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'مكتبة الصور' })).toBeInTheDocument()
    expect(tiles()).toEqual([1, 2, 3])

    const used = document.querySelector('[data-asset-id="2"]') as HTMLElement
    expect(within(used).getByText('مستخدم')).toBeInTheDocument()
    // مستخدم = مفيش حذف ولا تحديد للحذف الجماعي
    expect(used.querySelector('.ed-asset-delete')).toBeNull()
    expect(used.querySelector('input')).toBeDisabled()
    const free = document.querySelector('[data-asset-id="1"]') as HTMLElement
    expect(free.querySelector('.ed-asset-delete')).not.toBeNull()
    expect(free.querySelector('input')).toBeEnabled()
  })

  it('filters images by usage', () => {
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    const filter = screen.getByLabelText('فلترة الصور')
    fireEvent.change(filter, { target: { value: 'used' } })
    expect(tiles()).toEqual([2])
    fireEvent.change(filter, { target: { value: 'unused' } })
    expect(tiles()).toEqual([1, 3])
  })

  it('shows an empty message when the kind has nothing', () => {
    useEditor.getState().setAssets([])
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    expect(screen.getByText('لم تُرفع أي صور بعد.')).toBeInTheDocument()
  })

  it('renders video tiles from the saved frame, or from the file when there is no thumbnail', () => {
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'مكتبة الفيديو' })).toBeInTheDocument()
    source('رفع من جهازك')
    const withThumb = document.querySelector('[data-asset-id="4"] .ed-asset') as HTMLElement
    expect(withThumb.className).toContain('ed-asset--video-thumb')
    expect(withThumb.style.backgroundImage).toContain('poster.jpg')
    const without = document.querySelector('[data-asset-id="5"] .ed-asset') as HTMLElement
    expect(without.className).toContain('ed-asset--video-preview')
    expect(without.querySelector('video')).not.toBeNull()
  })

  it('picking a tile returns its url (and the video frame as the poster) and closes', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    mount(<AssetLibrary kind="video" onPick={onPick} onClose={onClose} />)
    source('رفع من جهازك')
    fireEvent.click(document.querySelector('[data-asset-id="4"] .ed-asset') as HTMLElement)
    expect(onPick).toHaveBeenCalledWith('/media/assets/2026/01/000000000004/v.mp4', {
      poster: '/media/assets/2026/01/000000000004/poster.jpg',
      thumb: '/media/assets/2026/01/000000000004/poster.jpg',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape and the close button close it', () => {
    const onClose = vi.fn()
    mount(<AssetLibrary kind="image" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('AssetLibrary — delete', () => {
  it('deletes one asset after confirmation and updates the library', async () => {
    deleteAsset.mockResolvedValue({ deleted: 1 })
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    fireEvent.click(within(document.querySelector('[data-asset-id="1"]') as HTMLElement).getByTitle('حذف الصورة من المكتبة'))
    await answerConfirm(true)
    await waitFor(() => expect(tiles()).toEqual([2, 3]))
    expect(deleteAsset).toHaveBeenCalledWith('invitation', 7, 1, 'image')
    expect(library().map((a) => a.id)).not.toContain(1)
    expect(await screen.findByText('تم حذف الملف من المكتبة.')).toBeInTheDocument()
  })

  it('does nothing when the confirmation is declined', async () => {
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    fireEvent.click(within(document.querySelector('[data-asset-id="1"]') as HTMLElement).getByTitle('حذف الصورة من المكتبة'))
    await answerConfirm(false)
    expect(deleteAsset).not.toHaveBeenCalled()
    expect(deleteAsset).not.toHaveBeenCalled()
    expect(tiles()).toEqual([1, 2, 3])
  })

  it('shows the server message and refreshes the in-use flags when the asset became used (409)', async () => {
    deleteAsset.mockRejectedValue(new ApiError(409, 'asset_in_use', 'مينفعش تمسح الصورة مستخدم داخل قالب أو دعوة.'))
    fetchAssets.mockResolvedValue({ assets: [asset(1, { used: true }), asset(2, { used: true }), asset(3)] })
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    fireEvent.click(within(document.querySelector('[data-asset-id="1"]') as HTMLElement).getByTitle('حذف الصورة من المكتبة'))
    await answerConfirm(true)
    expect(await screen.findByRole('alert')).toHaveTextContent('مينفعش تمسح الصورة')
    await waitFor(() => expect(fetchAssets).toHaveBeenCalledWith('invitation', 7))
    await waitFor(() => expect(library().find((a) => a.id === 1)?.used).toBe(true))
    // الأصل لسه موجود
    expect(tiles()).toContain(1)
  })

  it('bulk-deletes the checked assets', async () => {
    bulkDelete.mockResolvedValue({ deleted: [1, 3] })
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    const remove = screen.getByRole('button', { name: 'حذف المحدد' })
    expect(remove).toBeDisabled()
    expect(screen.getByText('لم يتم تحديد ملفات')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('تحديد a1.png'))
    fireEvent.click(screen.getByLabelText('تحديد a3.png'))
    expect(screen.getByText('تم تحديد 2 صورة')).toBeInTheDocument()
    fireEvent.click(remove)
    await answerConfirm(true)

    await waitFor(() => expect(tiles()).toEqual([2]))
    expect(bulkDelete).toHaveBeenCalledWith('invitation', 7, [1, 3], 'image')
    expect(screen.getByText('لم يتم تحديد ملفات')).toBeInTheDocument()
  })

  it('«select all» only exists for unused images and never selects in-use ones', () => {
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'تحديد الكل' })).toBeNull()
    fireEvent.change(screen.getByLabelText('فلترة الصور'), { target: { value: 'all' } })
    expect(screen.queryByRole('button', { name: 'تحديد الكل' })).toBeNull()

    fireEvent.change(screen.getByLabelText('فلترة الصور'), { target: { value: 'unused' } })
    fireEvent.click(screen.getByRole('button', { name: 'تحديد الكل' }))
    expect(screen.getByText('تم تحديد 2 صورة')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء تحديد الكل' }))
    expect(screen.getByText('لم يتم تحديد ملفات')).toBeInTheDocument()
  })

  it('a rejected bulk delete keeps the selection and reports the reason', async () => {
    bulkDelete.mockRejectedValue(new ApiError(409, 'asset_in_use', 'لم يتم حذف الصور; بعض الملفات المحددة مستخدمة.'))
    fetchAssets.mockResolvedValue({ assets: library() })
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('تحديد a1.png'))
    fireEvent.click(screen.getByRole('button', { name: 'حذف المحدد' }))
    await answerConfirm(true)
    expect(await screen.findByRole('alert')).toHaveTextContent('بعض الملفات المحددة مستخدمة')
    expect(tiles()).toEqual([1, 2, 3])
    expect(screen.getByText('تم تحديد 1 صورة')).toBeInTheDocument()
  })

  it('audio has no delete controls (the server only deletes images and videos)', () => {
    mount(<AssetLibrary kind="audio" onClose={() => {}} />)
    expect(document.querySelector('.ed-asset-delete')).toBeNull()
    expect(document.querySelector('.ed-asset-check')).toBeNull()
    expect(screen.queryByRole('button', { name: 'حذف المحدد' })).toBeNull()
  })
})

describe('AssetLibrary — upload', () => {
  const file = () => new File(['x'], 'جديدة.png', { type: 'image/png' })
  const choose = (files: File[]) =>
    fireEvent.change(screen.getByTestId('asset-file-input'), { target: { files } })

  it('uploads with progress, adds the asset to the library and picks it', async () => {
    const pending = deferred<AssetRow>()
    uploadAsset.mockImplementation((_mode, _id, _file, _thumb, onProgress) => {
      onProgress?.(0.5)
      return pending.promise
    })
    const onPick = vi.fn()
    const onClose = vi.fn()
    mount(<AssetLibrary kind="image" onPick={onPick} onClose={onClose} />)

    choose([file()])
    const bar = await screen.findByRole('progressbar', { name: 'جارٍ رفع جديدة.png' })
    expect(bar).toHaveAttribute('value', '0.5')

    pending.resolve(asset(9, { name: 'جديدة.png' }))
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onPick.mock.calls[0][0]).toBe(asset(9).url)
    expect(onClose).toHaveBeenCalled()
    expect(library()[0].id).toBe(9)
    expect(uploadAsset).toHaveBeenCalledWith('invitation', 7, expect.any(File), null, expect.any(Function))
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows the failure on the upload row and as a toast, without picking anything', async () => {
    uploadAsset.mockRejectedValue(new ApiError(400, 'validation_error', 'نوع الملف غير مسموح.'))
    const onPick = vi.fn()
    mount(<AssetLibrary kind="image" onPick={onPick} onClose={() => {}} />)
    choose([file()])
    await waitFor(() => expect(screen.getAllByText('نوع الملف غير مسموح.').length).toBeGreaterThan(0))
    expect(onPick).not.toHaveBeenCalled()
    expect(library()).toHaveLength(6)
    // إخفاء صف الفشل
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء' }))
    expect(document.querySelector('.ed-uploads')).toBeNull()
  })

  it('explains a 413 from the host in plain words', async () => {
    uploadAsset.mockRejectedValue(new ApiError(413, 'payload_too_large', ''))
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    choose([new File(['x'], 'clip.mp4', { type: 'video/mp4' })])
    expect(await screen.findByRole('alert')).toHaveTextContent('حجمه كبير')
  })

  it('uploads several files one after the other and picks only the first', async () => {
    uploadAsset.mockImplementation(async (_m, _i, f) => asset(f.name === 'one.png' ? 10 : 11, { name: f.name }))
    const onPick = vi.fn()
    mount(<AssetLibrary kind="image" onPick={onPick} onClose={() => {}} />)
    choose([new File(['1'], 'one.png', { type: 'image/png' }), new File(['2'], 'two.png', { type: 'image/png' })])
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(library().slice(0, 2).map((a) => a.id)).toEqual([11, 10]))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toBe(asset(10).url)
  })

  it('does not pick an upload of the wrong kind (a video dropped on the image picker)', async () => {
    uploadAsset.mockResolvedValue(asset(12, { kind: 'video' }))
    const onPick = vi.fn()
    mount(<AssetLibrary kind="image" onPick={onPick} onClose={() => {}} />)
    choose([new File(['x'], 'clip.mp4', { type: 'video/mp4' })])
    await waitFor(() => expect(library()[0].id).toBe(12))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('asks the file dialog for the right file types', () => {
    const { unmount } = mount(<AssetLibrary kind="audio" onClose={() => {}} />)
    expect(screen.getByTestId('asset-file-input')).toHaveAttribute('accept', 'audio/*')
    unmount()
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    expect(screen.getByTestId('asset-file-input').getAttribute('accept')).toContain('video/mp4')
  })
})

describe('AssetLibrary — shared libraries', () => {
  it('audio: lists the music library above the uploads and picks a track', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    mount(<AssetLibrary kind="audio" onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'مكتبة الموسيقى' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'نغمة الفرح' }))
    expect(onPick).toHaveBeenCalledWith('/media/music/farah.mp3', {})
    expect(onClose).toHaveBeenCalled()
  })

  it('video: asks which library first, with the counts', () => {
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    expect(screen.getByText('تجيب الفيديو منين؟')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /مكتبة الفيديوهات/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /مكتبة الافتتاحيات/ })).toHaveTextContent('1')
    // قبل الاختيار: مفيش شبكة ملفات ولا زر رفع
    expect(document.querySelector('.ed-asset-wrap')).toBeNull()
    expect(screen.queryByRole('button', { name: 'رفع ملفات' })).not.toBeInTheDocument()
  })

  it('video: the video library shows previews and hands back the video (frame as poster)', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    mount(<AssetLibrary kind="video" onPick={onPick} onClose={onClose} />)
    source('مكتبة الفيديوهات')
    const tile = screen.getByRole('button', { name: /فيديو الحنة · 12s/ })
    expect(tile.querySelector('video')).not.toBeNull()
    // الافتتاحيات مش ظاهرة هنا
    expect(screen.queryByRole('button', { name: /افتتاحية ذهبية/ })).not.toBeInTheDocument()
    fireEvent.click(tile)
    // من غير غلاف محفوظ بنستنى أول فريم (حد أقصى ١.٨ ثانية في jsdom لأنه مابيحمّلش فيديو)
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/media/videos/henna.mp4', expect.any(Object)), { timeout: 3000 })
    expect(onClose).toHaveBeenCalled()
  })

  it('video: can go back and choose another library', () => {
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    source('مكتبة الفيديوهات')
    fireEvent.click(screen.getByRole('button', { name: 'رجوع' }))
    source('مكتبة الافتتاحيات')
    expect(screen.getByRole('button', { name: /افتتاحية ذهبية/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /فيديو الحنة/ })).not.toBeInTheDocument()
  })

  it('video: says so when a library is empty', () => {
    useEditor.getState().load(boot({ videos: [] }))
    mount(<AssetLibrary kind="video" onClose={() => {}} />)
    source('مكتبة الفيديوهات')
    expect(screen.getByText(/مكتبة الفيديوهات فاضية/)).toBeInTheDocument()
  })

  it('video: the intro library hands back its saved poster', async () => {
    const onPick = vi.fn()
    mount(<AssetLibrary kind="video" onPick={onPick} onClose={() => {}} />)
    source('مكتبة الافتتاحيات')
    fireEvent.click(screen.getByRole('button', { name: /افتتاحية ذهبية · 4s/ }))
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith('/media/intros/gold.mp4', { poster: '/media/intros/gold.jpg', thumb: '/media/intros/gold.jpg' }),
    )
  })

  it('images have no shared library', () => {
    mount(<AssetLibrary kind="image" onClose={() => {}} />)
    expect(document.querySelector('.ed-lib')).toBeNull()
  })
})
