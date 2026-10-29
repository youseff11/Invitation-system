import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import { resetEditor, useEditor } from '../store'
import * as api from './api'
import { CropDialog } from './CropDialog'
import { asset, boot, mount } from './testkit'

vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), cropAsset: vi.fn() }))
const cropAsset = vi.mocked(api.cropAsset)

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** المسرح 400×300، والصورة 300×200 متوسّطة جواه عند (50, 20) — jsdom مابيعملش layout فبنزيّفه. */
function fakeLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('ed-crop-stage')) return rect(0, 0, 400, 300)
    if (this.tagName === 'IMG') return rect(50, 20, 300, 200)
    return rect(0, 0, 0, 0)
  })
}

const source = asset(1, { name: 'صورة.png' })
const box = () => screen.getByTestId('crop-box')
const px = (name: 'left' | 'top' | 'width' | 'height') => parseFloat(box().style[name])
const open = (onDone = vi.fn(), onClose = vi.fn()) => {
  mount(<CropDialog asset={source} onDone={onDone} onClose={onClose} />)
  fireEvent.load(screen.getByAltText('صورة.png'))
  return { onDone, onClose }
}

beforeAll(() => initI18n('ar'))
beforeEach(() => {
  resetEditor()
  vi.clearAllMocks()
  fakeLayout()
  useEditor.getState().load(boot({ assets: [source] }))
})
afterEach(() => vi.restoreAllMocks())

describe('CropDialog', () => {
  it('crops from the original file, not the displayed one', () => {
    open()
    expect(screen.getByAltText('صورة.png')).toHaveAttribute('src', source.source)
  })

  it('starts with an 80% box centred on the image and no apply until the image has loaded', () => {
    mount(<CropDialog asset={source} onDone={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'اقصّ' })).toBeDisabled()
    fireEvent.load(screen.getByAltText('صورة.png'))
    expect([px('left'), px('top'), px('width'), px('height')]).toEqual([80, 40, 240, 160])
    expect(screen.getByRole('button', { name: 'اقصّ' })).toBeEnabled()
  })

  it('sends the box as ratios of the image, adds the new asset to the library and reports it', async () => {
    const cropped = asset(2, { name: 'صورة.png', url: '/media/assets/2026/01/000000000002/c.webp' })
    cropAsset.mockResolvedValue({ asset: cropped })
    const { onDone, onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'اقصّ' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(cropped))
    const [mode, id, assetId, ratios] = cropAsset.mock.calls[0]
    expect([mode, id, assetId]).toEqual(['invitation', 7, 1])
    expect(ratios.x).toBeCloseTo(0.1)
    expect(ratios.y).toBeCloseTo(0.1)
    expect(ratios.w).toBeCloseTo(0.8)
    expect(ratios.h).toBeCloseTo(0.8)
    expect(useEditor.getState().lib.assets.map((a) => a.id)).toEqual([2, 1])
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('اتقصّت الصورة.')).toBeInTheDocument()
  })

  it('applies an aspect ratio to the box', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: '16:9' }))
    expect(px('width')).toBe(240)
    expect(px('height')).toBeCloseTo(135)
    fireEvent.click(screen.getByRole('button', { name: 'مربع' }))
    // مربع 240×240 مش داخل الصورة (الارتفاع 200): المربع بيتحدّد بالصورة
    expect(px('height')).toBe(200)
    expect(px('top')).toBe(20)
    expect(screen.getByRole('button', { name: 'مربع' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('moves the box with the pointer and stops at the image edge', () => {
    open()
    fireEvent.pointerDown(box(), { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box(), { clientX: 110, clientY: 90, pointerId: 1 })
    expect([px('left'), px('top')]).toEqual([90, 30])
    fireEvent.pointerMove(box(), { clientX: 900, clientY: 900, pointerId: 1 })
    expect([px('left'), px('top')]).toEqual([110, 60]) // 50 + 300 - 240 ، 20 + 200 - 160
    fireEvent.pointerUp(box(), { pointerId: 1 })
    fireEvent.pointerMove(box(), { clientX: 0, clientY: 0, pointerId: 1 })
    expect([px('left'), px('top')]).toEqual([110, 60])
  })

  it('resizes from the bottom-right corner', () => {
    open()
    const corner = box().querySelector('[data-handle="se"]') as HTMLElement
    fireEvent.pointerDown(corner, { clientX: 320, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(box(), { clientX: 300, clientY: 190, pointerId: 1 })
    expect([px('left'), px('top'), px('width'), px('height')]).toEqual([80, 40, 220, 150])
  })

  it('keeps the dialog open and says why when the server refuses', async () => {
    cropAsset.mockRejectedValue(new ApiError(403, 'forbidden', 'الصورة مش من مكتبة الدعوة دي.'))
    const { onDone, onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'اقصّ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('الصورة مش من مكتبة الدعوة دي.')
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'اقصّ' })).toBeEnabled()
  })

  it('cancel closes without cropping', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(onClose).toHaveBeenCalled()
    expect(cropAsset).not.toHaveBeenCalled()
  })
})
