import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import * as api from './api'
import { boot, mount } from './assets/testkit'
import { SaveTemplateButton } from './SaveTemplateDialog'
import { resetEditor, useEditor } from './store'

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  postSaveTemplate: vi.fn(),
}))
const postSaveTemplate = vi.mocked(api.postSaveTemplate)

beforeAll(() => initI18n('ar'))
beforeEach(() => {
  resetEditor()
  vi.clearAllMocks()
  useEditor.getState().load(
    boot({
      title: 'دعوة سارة',
      categories: [
        { value: 'wedding', label: 'زفاف' },
        { value: 'birthday', label: 'عيد ميلاد' },
      ],
    }),
  )
})
afterEach(() => vi.restoreAllMocks())

const open = () => {
  mount(<SaveTemplateButton />)
  fireEvent.click(screen.getByRole('button', { name: 'حفظ كقالب' }))
}

describe('SaveTemplateButton', () => {
  it('sends the current (unsaved) document with the form values and closes on success', async () => {
    postSaveTemplate.mockResolvedValue({ templateId: 9, slug: 'my-one', name: 'قالبي' })
    open()
    expect(screen.getByLabelText('اسم القالب')).toHaveValue('دعوة سارة')
    useEditor.getState().setProp('a', 'heading', 'غير محفوظ')
    fireEvent.change(screen.getByLabelText('اسم القالب'), { target: { value: 'قالبي' } })
    fireEvent.change(screen.getByLabelText('التصنيف'), { target: { value: 'birthday' } })
    fireEvent.change(screen.getByLabelText('المجموعة'), { target: { value: 'Gold' } })
    fireEvent.click(screen.getByLabelText('ظاهر للعملاء'))
    fireEvent.click(screen.getByRole('button', { name: 'حفظ القالب' }))

    await waitFor(() => expect(postSaveTemplate).toHaveBeenCalledTimes(1))
    const [id, doc, form] = postSaveTemplate.mock.calls[0]
    expect(id).toBe(7)
    expect(doc.blocks[0].props.heading).toBe('غير محفوظ')
    expect(form).toEqual({ name: 'قالبي', slug: '', category: 'birthday', collection: 'Gold', description: '', isActive: false })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText(/اتحفظ القالب «قالبي»/)).toBeInTheDocument()
  })

  it('shows the server name error inline and keeps the dialog open', async () => {
    postSaveTemplate.mockRejectedValue(new ApiError(400, 'invalid', 'راجع البيانات', { name: 'اكتب اسماً للقالب.' }))
    open()
    fireEvent.click(screen.getByRole('button', { name: 'حفظ القالب' }))
    expect(await screen.findByText('اكتب اسماً للقالب.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('reports other failures as a toast and keeps the dialog open', async () => {
    postSaveTemplate.mockRejectedValue(new ApiError(500, 'server_error', 'عطل في السيرفر'))
    open()
    fireEvent.click(screen.getByRole('button', { name: 'حفظ القالب' }))
    expect(await screen.findByText('عطل في السيرفر')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses a too-short name without calling the server', () => {
    open()
    fireEvent.change(screen.getByLabelText('اسم القالب'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'حفظ القالب' })).toBeDisabled()
    expect(postSaveTemplate).not.toHaveBeenCalled()
  })
})
