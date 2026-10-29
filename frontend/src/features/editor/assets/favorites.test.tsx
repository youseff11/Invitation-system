import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import { answerConfirm } from '../confirmTestUtil'
import { BlocksPanel } from '../panels/BlocksPanel'
import { InspectorPanel } from '../panels/InspectorPanel'
import { resetEditor, useEditor } from '../store'
import type { FavoriteRow } from '../types'
import * as api from './api'
import { addFavoriteToDocument } from './favorites'
import { FavoritesDialog, SaveFavoriteButton } from './FavoritesDialog'
import { block, boot, mount, schema, textSpec } from './testkit'

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchFavorites: vi.fn(),
  createFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
}))
const fetchFavorites = vi.mocked(api.fetchFavorites)
const createFavorite = vi.mocked(api.createFavorite)
const deleteFavorite = vi.mocked(api.deleteFavorite)

const favorite = (id: number, type = 'text', name = `مفضلة ${id}`): FavoriteRow => ({
  id,
  name,
  blockType: type,
  block: block('old-id', type, { props: { heading: 'محفوظ' }, label: 'بالاسم' }),
})
const ids = () => useEditor.getState().doc.blocks.map((b) => b.id)
const s = () => useEditor.getState()

beforeAll(() => initI18n('ar'))
beforeEach(() => {
  resetEditor()
  vi.clearAllMocks()
  s().load(boot())
})
afterEach(() => vi.restoreAllMocks())

describe('addFavoriteToDocument', () => {
  it('inserts a copy after the selected section with a fresh id and selects it', () => {
    s().select('a', 'list')
    s().setTab('blocks')
    expect(addFavoriteToDocument(favorite(1), schema)).toBe('added')
    expect(ids()).toHaveLength(3)
    expect(ids()[0]).toBe('a')
    expect(ids()[1]).not.toBe('old-id')
    expect(ids()[1]).toMatch(/^text-/)
    expect(ids()[2]).toBe('b')
    expect(s().doc.blocks[1]).toMatchObject({ props: { heading: 'محفوظ' }, label: 'بالاسم' })
    expect(s()).toMatchObject({ selected: ids()[1], tab: 'inspector', saveStatus: 'dirty' })
  })

  it('appends at the end when nothing is selected, as one undo step', () => {
    addFavoriteToDocument(favorite(1), schema)
    expect(ids().at(-1)).toMatch(/^text-/)
    s().undo()
    expect(ids()).toEqual(['a', 'b'])
  })

  it('copies deeply, so editing the copy never touches the saved favorite', () => {
    const saved = favorite(1)
    addFavoriteToDocument(saved, schema)
    expect(s().doc.blocks.at(-1)!.props).not.toBe(saved.block.props)
  })

  it('refuses a block type that is no longer in the schema', () => {
    expect(addFavoriteToDocument(favorite(1, 'retired'), schema)).toBe('invalid')
    expect(ids()).toEqual(['a', 'b'])
  })

  it('refuses a second singleton section but allows the first', () => {
    expect(addFavoriteToDocument(favorite(1, 'hero'), schema)).toBe('added')
    expect(addFavoriteToDocument(favorite(2, 'hero'), schema)).toBe('singleton')
    expect(s().doc.blocks.filter((b) => b.type === 'hero')).toHaveLength(1)
  })
})

describe('FavoritesDialog', () => {
  it('loads the library, shows the section type, and adds a favorite to the document', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [favorite(1, 'text', 'غلاف جميل'), favorite(2, 'retired')] })
    const onClose = vi.fn()
    mount(<FavoritesDialog schema={schema} onClose={onClose} />)
    expect(screen.getByText('جارٍ تحميل المفضلة…')).toBeInTheDocument()

    const row = (await screen.findByText('غلاف جميل')).closest('.ed-favorite-row') as HTMLElement
    expect(within(row).getByText('قسم نصي')).toBeInTheDocument()
    // نوع اتشال من السكيما بيظهر باسمه الخام
    expect(screen.getByText('retired')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'استخدام' }))
    expect(ids()).toHaveLength(3)
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('اتضافت نسخة من العنصر المفضل.')).toBeInTheDocument()
  })

  it('keeps the dialog open and explains when a favorite cannot be added', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [favorite(1, 'retired', 'قديم')] })
    const onClose = vi.fn()
    mount(<FavoritesDialog schema={schema} onClose={onClose} />)
    fireEvent.click(within((await screen.findByText('قديم')).closest('.ed-favorite-row') as HTMLElement).getByRole('button', { name: 'استخدام' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('غير صالح أو لم يعد مدعوماً')
    expect(onClose).not.toHaveBeenCalled()
    expect(ids()).toHaveLength(2)
  })

  it('deletes after confirmation and drops the row', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [favorite(1, 'text', 'أول'), favorite(2, 'text', 'تاني')] })
    deleteFavorite.mockResolvedValue({ deleted: 1 })
    mount(<FavoritesDialog schema={schema} onClose={() => {}} />)
    const row = (await screen.findByText('أول')).closest('.ed-favorite-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }))
    await answerConfirm(true)
    await waitFor(() => expect(screen.queryByText('أول')).toBeNull())
    expect(deleteFavorite).toHaveBeenCalledWith(1)
    expect(screen.getByText('تاني')).toBeInTheDocument()
  })

  it('does not delete when the confirmation is declined', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [favorite(1, 'text', 'أول')] })
    mount(<FavoritesDialog schema={schema} onClose={() => {}} />)
    fireEvent.click(within((await screen.findByText('أول')).closest('.ed-favorite-row') as HTMLElement).getByRole('button', { name: 'حذف' }))
    await answerConfirm(false)
    expect(deleteFavorite).not.toHaveBeenCalled()
  })

  it('shows an empty state and a retry on failure', async () => {
    fetchFavorites.mockResolvedValueOnce({ favorites: [] })
    const { unmount } = mount(<FavoritesDialog schema={schema} onClose={() => {}} />)
    expect(await screen.findByText(/مكتبة المفضلة فاضية/)).toBeInTheDocument()
    unmount()

    fetchFavorites.mockRejectedValueOnce(new ApiError(500, 'server_error', 'عطل في السيرفر')).mockResolvedValueOnce({ favorites: [favorite(1, 'text', 'رجعت')] })
    mount(<FavoritesDialog schema={schema} onClose={() => {}} />)
    expect(await screen.findByText('عطل في السيرفر')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(await screen.findByText('رجعت')).toBeInTheDocument()
  })
})

describe('SaveFavoriteButton', () => {
  const spec = textSpec
  const target = block('a', 'text', { props: { heading: 'س' } })

  it('asks for a name (defaulting to the section name) and saves the block', async () => {
    createFavorite.mockResolvedValue({ favorite: favorite(5, 'text', 'اسمي') })
    mount(<SaveFavoriteButton block={target} spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: '☆ حفظ كمفضلة' }))

    const input = screen.getByLabelText('اكتب اسماً لهذا العنصر المفضل') as HTMLInputElement
    expect(input.value).toBe('قسم نصي')
    fireEvent.change(input, { target: { value: '  اسمي  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))

    await waitFor(() => expect(createFavorite).toHaveBeenCalledWith('اسمي', target))
    expect(await screen.findByText('اتحفظ العنصر في مكتبة المفضلة.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('prefers the custom label as the default name and blocks an empty name', () => {
    mount(<SaveFavoriteButton block={{ ...target, label: 'دعوتي' }} spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: '☆ حفظ كمفضلة' }))
    const input = screen.getByLabelText('اكتب اسماً لهذا العنصر المفضل') as HTMLInputElement
    expect(input.value).toBe('دعوتي')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeDisabled()
  })

  it('keeps the dialog and shows the server message on failure', async () => {
    createFavorite.mockRejectedValue(new ApiError(400, 'validation_error', 'العنصر المحدد غير صالح للحفظ.', { block: 'العنصر المحدد غير صالح للحفظ.' }))
    mount(<SaveFavoriteButton block={target} spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: '☆ حفظ كمفضلة' }))
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('غير صالح للحفظ')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Cancel closes it without saving', () => {
    mount(<SaveFavoriteButton block={target} spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: '☆ حفظ كمفضلة' }))
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createFavorite).not.toHaveBeenCalled()
  })
})

describe('panel entry points', () => {
  it('the sections tab has the favorites button, which opens the library', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [] })
    mount(<BlocksPanel schema={schema} />)
    fireEvent.click(screen.getByRole('button', { name: '★ المفضلة' }))
    expect(screen.getByRole('dialog', { name: 'مكتبة المفضلة' })).toBeInTheDocument()
    await screen.findByText(/مكتبة المفضلة فاضية/)
  })

  it('the inspector header has «save as favorite» for the selected section only', () => {
    mount(<InspectorPanel schema={schema} />)
    expect(screen.queryByRole('button', { name: '☆ حفظ كمفضلة' })).toBeNull()
    act(() => s().select('a', 'list'))
    expect(screen.getByRole('button', { name: '☆ حفظ كمفضلة' })).toBeInTheDocument()
  })
})
