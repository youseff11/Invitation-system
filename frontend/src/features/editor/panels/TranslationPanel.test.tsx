import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'

import '../fields'
import { answerConfirm } from '../confirmTestUtil'
import { resetEditor, useEditor } from '../store'
import type { Bootstrap, TranslationRows } from '../types'
import { EditorUiProvider } from '../ui'
import { TranslationPanel } from './TranslationPanel'

vi.mock('../api', () => ({ fetchTranslations: vi.fn() }))
// قايمة الخطوط بتيجي من السكيما — مالهاش لازمة هنا
vi.mock('../hooks', () => ({ useSchema: () => ({ data: undefined }) }))
import { fetchTranslations } from '../api'

const fetchRows = vi.mocked(fetchTranslations)

const rows = (extra: TranslationRows['entries'] = []): TranslationRows => ({
  baseLang: 'ar',
  altLang: 'en',
  entries: [
    { key: 'data.name_one', label: 'الاسم الأول', value: 'ليلى', group: 'بيانات المناسبة' },
    { key: 'hero-1.kicker', label: 'النص التمهيدي', value: 'دعوة زفاف', group: 'الغلاف' },
    { key: 'text-1.body', label: 'النص', value: 'ا'.repeat(80), group: 'نص' },
    ...extra,
  ],
})

const boot = (): Bootstrap => ({
  mode: 'invitation', id: 3, title: 't',
  document: { version: 1, theme: {}, settings: {}, blocks: [], i18n: { en: { 'hero-1.kicker': 'Wedding', 'gone.key': 'x' }, ar: {} } },
  fields: null, features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
  meta: { slug: 's', status: 'draft', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
})

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  resetEditor()
  useEditor.getState().load(boot())
  fetchRows.mockReset()
  fetchRows.mockResolvedValue(rows())
})
afterEach(() => vi.restoreAllMocks())

const mount = () =>
  render(
    <EditorUiProvider>
      <TranslationPanel />
    </EditorUiProvider>,
  )

describe('TranslationPanel', () => {
  it('lists the rows grouped, with the base text read-only and the existing translation filled in', async () => {
    mount()
    expect(await screen.findByText('بيانات المناسبة')).toBeInTheDocument()
    expect(screen.getByText('الغلاف')).toBeInTheDocument()
    expect(screen.getByText('دعوة زفاف')).toHaveClass('ed-i18n-src')
    expect(within(document.querySelector('[data-i18n-key="hero-1.kicker"]') as HTMLElement).getByRole('textbox')).toHaveValue('Wedding')
    // نص طويل = خانة متعددة الأسطر
    expect(document.querySelector('[data-i18n-key="text-1.body"] textarea')).not.toBeNull()
    expect(document.querySelector('[data-i18n-key="data.name_one"] input')).toHaveAttribute('dir', 'ltr')
    expect(fetchRows).toHaveBeenCalledWith('invitation', 3, expect.anything(), null, expect.anything())
  })

  it('counts what is translated and drops translations whose text is gone', async () => {
    mount()
    await screen.findByText('الغلاف')
    await waitFor(() => expect(useEditor.getState().doc.i18n?.en).toEqual({ 'hero-1.kicker': 'Wedding' }))
    expect(screen.getByText('مترجَم 1 من 3 نص.')).toBeInTheDocument()
  })

  it('stores the trimmed text but lets the user type spaces between words', async () => {
    mount()
    await screen.findByText('الغلاف')
    const input = within(document.querySelector('[data-i18n-key="data.name_one"]') as HTMLElement).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Layla ' } })
    expect(input).toHaveValue('Layla ')
    expect(useEditor.getState().doc.i18n?.en?.['data.name_one']).toBe('Layla')
    fireEvent.change(input, { target: { value: '  ' } })
    expect(useEditor.getState().doc.i18n?.en).not.toHaveProperty('data.name_one')
    // تراجع من برّه بيرجّع الخانة للقيمة المحفوظة
    fireEvent.change(input, { target: { value: 'Layla' } })
    useEditor.getState().undo()
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('toggles the translated preview', async () => {
    mount()
    await screen.findByText('الغلاف')
    fireEvent.click(screen.getByRole('button', { name: 'عاين بالنسخة الإنجليزية' }))
    expect(useEditor.getState().previewLang).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'رجّع المعاينة عربي' }))
    expect(useEditor.getState().previewLang).toBe('')
  })

  it('styles one translated text (font and size) and marks the gear', async () => {
    mount()
    await screen.findByText('الغلاف')
    const field = document.querySelector('[data-i18n-key="hero-1.kicker"]') as HTMLElement
    fireEvent.click(within(field).getByLabelText('تنسيق النص المترجَم'))
    const size = field.querySelector('.ed-inline-font-panel input[type="number"]') as HTMLInputElement
    fireEvent.change(size, { target: { value: '28' } })
    expect(useEditor.getState().doc.i18n_style?.en?.['hero-1.kicker']).toEqual({ size: 28 })
    expect(within(field).getByLabelText('تنسيق النص المترجَم')).toHaveClass('is-set')
    fireEvent.change(size, { target: { value: '0' } })
    expect(useEditor.getState().doc.i18n_style?.en).toEqual({})
  })

  it('clears the whole version only after confirming', async () => {
    mount()
    await screen.findByText('الغلاف')
    fireEvent.click(screen.getByRole('button', { name: 'مسح الترجمة' }))
    await answerConfirm(false)
    expect(useEditor.getState().doc.i18n?.en).toHaveProperty('hero-1.kicker')
    fireEvent.click(screen.getByRole('button', { name: 'مسح الترجمة' }))
    await answerConfirm(true)
    expect(useEditor.getState().doc.i18n?.en).toEqual({})
  })

  it('flips to Arabic as the alternate language for an English-based invitation', async () => {
    useEditor.setState({ doc: { ...useEditor.getState().doc, theme: { base_lang: 'en' } } })
    fetchRows.mockResolvedValue({ ...rows(), baseLang: 'en', altLang: 'ar' })
    mount()
    await screen.findByText('الغلاف')
    expect(screen.getByText('النسخة العربية')).toBeInTheDocument()
    expect(document.querySelector('[data-i18n-key="data.name_one"] input')).toHaveAttribute('dir', 'rtl')
  })

  it('says so when the rows cannot be loaded', async () => {
    fetchRows.mockRejectedValue(new Error('offline'))
    mount()
    expect(await screen.findByText('تعذّر تحميل النصوص.')).toBeInTheDocument()
  })
})
