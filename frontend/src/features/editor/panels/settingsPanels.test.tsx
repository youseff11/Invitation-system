import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { initI18n } from '@/i18n'

import '../fields'
import { answerConfirm } from '../confirmTestUtil'
import { resetEditor, useEditor } from '../store'
import type { Bootstrap, EditorSchema, EventFields, FieldSpec } from '../types'
import { EditorUiProvider } from '../ui'
import { DataPanel } from './DataPanel'
import { SettingsPanel } from './SettingsPanel'
import { ThemePanel } from './ThemePanel'

vi.mock('../api', () => ({ postSave: vi.fn() }))
vi.mock('../hooks', () => ({ useSchema: () => ({ data: undefined }) }))
import { postSave } from '../api'

const save = vi.mocked(postSave)

const field = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'type'>): FieldSpec => ({
  label: over.key,
  default: '',
  group: 'عام',
  ...over,
})

const schema = {
  version: 1,
  blocks: {},
  theme_fields: [
    field({ key: 'accent', type: 'color', label: 'اللون المميز', group: 'الألوان' }),
    field({ key: 'radius', type: 'range', label: 'الاستدارة', group: 'الشكل', min: 0, max: 40, unit: 'px' }),
    field({ key: 'animations_enabled', type: 'toggle', label: 'الحركات', group: 'عام' }),
  ],
  settings_fields: [
    field({ key: 'music_url', type: 'media', media_kind: 'audio', label: 'ملف الموسيقى', group: 'الموسيقى', feature: 'music' }),
    field({ key: 'intro_enabled', type: 'toggle', label: 'شاشة افتتاحية', group: 'الافتتاحية' }),
    field({ key: 'intro_note', type: 'text', label: 'سطر الترحيب', group: 'الافتتاحية' }),
    field({ key: 'intro_note_color', type: 'color', label: 'لون السطر', group: 'الافتتاحية', editor_hidden: true, style_of: 'intro_note', style_role: 'color' }),
    field({ key: 'intro_note_size', type: 'range', label: 'حجم السطر', group: 'الافتتاحية', editor_hidden: true, style_of: 'intro_note', style_role: 'size', min: 8, max: 80 }),
  ],
  fonts: [],
  animations: [],
  dividers: [],
  layout_max: { x: 1000, y: 1000 },
} as EditorSchema

const fields = (over: Partial<EventFields> = {}): EventFields => ({
  title: 'عرس ليلى',
  eventType: 'زفاف',
  nameOne: 'ليلى',
  nameTwo: 'أحمد',
  eventDate: '2030-05-01T20:30',
  venue: 'القاعة',
  address: 'القاهرة',
  mapUrl: '',
  whatsapp: '0100',
  status: 'draft',
  expiresAt: '',
  password: '',
  slug: 'laila-ahmed',
  ...over,
})

const boot = (over: Partial<Bootstrap> = {}): Bootstrap => ({
  mode: 'invitation',
  id: 1,
  title: 't',
  document: { version: 1, theme: { accent: '#b8914f', radius: 12, animations_enabled: true }, settings: { intro_enabled: false, intro_note: 'أهلاً', intro_note_color: '', intro_note_size: 18 }, blocks: [] },
  fields: fields(),
  features: [],
  assets: [], fonts: [], intros: [], music: [], categories: [],
  statusChoices: [{ value: 'draft', label: 'مسودة' }, { value: 'published', label: 'منشورة' }],
  meta: {
    slug: 'laila-ahmed', status: 'draft', planName: '', templateName: '',
    publicUrl: 'https://example.test/i/laila-ahmed/',
    clientFollowupUrl: 'https://example.test/client/xyz/',
    backUrl: '',
  },
  ...over,
})

const s = () => useEditor.getState()
const ui = (node: React.ReactElement) => render(<EditorUiProvider>{node}</EditorUiProvider>)

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  resetEditor()
  save.mockReset()
  s().load(boot())
})
afterEach(() => vi.restoreAllMocks())

describe('ThemePanel', () => {
  it('builds the groups from theme_fields and writes into doc.theme', () => {
    ui(<ThemePanel schema={schema} />)
    expect([...document.querySelectorAll('details.ed-group > summary')].map((n) => n.textContent)).toEqual(['الألوان', 'الشكل', 'عام'])

    fireEvent.change(document.querySelector('[data-field-key="accent"] input[type="text"]')!, { target: { value: '#112233' } })
    expect(s().doc.theme.accent).toBe('#112233')
    expect(s().saveStatus).toBe('dirty')

    fireEvent.change(document.querySelector('[data-field-key="radius"] input[type="range"]')!, { target: { value: '30' } })
    expect(s().doc.theme.radius).toBe(30)

    fireEvent.click(document.querySelector('[data-field-key="animations_enabled"] input[type="checkbox"]')!)
    expect(s().doc.theme.animations_enabled).toBe(false)
  })

  it('bumps the revision so the preview refreshes, and leaves the settings alone', () => {
    const before = s().rev
    ui(<ThemePanel schema={schema} />)
    fireEvent.change(document.querySelector('[data-field-key="accent"] input[type="text"]')!, { target: { value: '#abcdef' } })
    expect(s().rev).toBe(before + 1)
    expect(s().doc.settings.intro_note).toBe('أهلاً')
  })
})

describe('SettingsPanel', () => {
  it('writes into doc.settings and warns about a feature outside the plan', () => {
    ui(<SettingsPanel schema={schema} />)
    const music = document.querySelector('[data-field-key="music_url"]') as HTMLElement
    expect(music.querySelector('.ed-gate-tag')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-field-key="intro_enabled"] input[type="checkbox"]')!)
    expect(s().doc.settings.intro_enabled).toBe(true)
    expect(s().doc.theme.accent).toBe('#b8914f')
  })

  it('shows a text-style gear for the intro texts and writes the style into settings', () => {
    s().load(boot({ features: ['music'] }))
    ui(<SettingsPanel schema={schema} />)

    expect(document.querySelector('[data-field-key="intro_note_color"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /تنسيق النص: سطر الترحيب/ }))
    const panel = within(document.querySelector('.ed-inline-font-panel') as HTMLElement)
    fireEvent.change(panel.getByRole('textbox'), { target: { value: '#ff0000' } })
    expect(s().doc.settings.intro_note_color).toBe('#ff0000')
    expect(s().doc.settings.intro_note).toBe('أهلاً') // النص نفسه ما اتلمسش
    fireEvent.change(panel.getByRole('slider'), { target: { value: '30' } })
    expect(s().doc.settings.intro_note_size).toBe(30)
  })
})

describe('DataPanel', () => {
  const input = (name: string) => document.querySelector(`[data-event-field="${name}"] :is(input, select)`) as HTMLInputElement

  it('shows nothing in template mode', () => {
    s().load(boot({ mode: 'template', fields: null }))
    const { container } = ui(<DataPanel />)
    expect(container.querySelector('.ed-group')).toBeNull()
  })

  it('shows the saved event details in three groups', () => {
    ui(<DataPanel />)
    expect([...document.querySelectorAll('details.ed-group > summary')].map((n) => n.textContent)).toEqual(['الأساسيات', 'المكان والتواصل', 'النشر'])
    expect(input('nameOne').value).toBe('ليلى')
    expect(input('eventDate').value).toBe('2030-05-01T20:30')
    expect(input('venue').value).toBe('القاعة')
    expect(input('status').value).toBe('draft')
    expect([...input('status').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['مسودة', 'منشورة'])
  })

  it('writes edits into store.fields and marks the invitation dirty for save and preview', () => {
    ui(<DataPanel />)
    const rev = s().rev
    fireEvent.change(input('nameOne'), { target: { value: 'سارة' } })
    fireEvent.change(input('status'), { target: { value: 'published' } })
    fireEvent.change(input('eventDate'), { target: { value: '2031-01-02T10:00' } })
    expect(s().fields).toMatchObject({ nameOne: 'سارة', status: 'published', eventDate: '2031-01-02T10:00', nameTwo: 'أحمد' })
    expect(s().saveStatus).toBe('dirty')
    expect(s().rev).toBe(rev + 3)
    expect(s().doc.blocks).toEqual([]) // المستند ماتلمسش
  })

  it('shows the validation error under its field and clears it on edit', () => {
    useEditor.setState({ fieldErrors: { eventDate: 'تاريخ غير صالح', slug: 'الرابط محجوز' } })
    ui(<DataPanel />)
    const row = document.querySelector('[data-event-field="eventDate"]') as HTMLElement
    expect(within(row).getByRole('alert').textContent).toBe('تاريخ غير صالح')
    expect(within(document.querySelector('[data-event-field="slug"]') as HTMLElement).getByRole('alert').textContent).toBe('الرابط محجوز')

    fireEvent.change(input('eventDate'), { target: { value: '2031-01-02T10:00' } })
    expect(within(row).queryByRole('alert')).toBeNull()
    expect(s().fieldErrors).toEqual({ slug: 'الرابط محجوز' })
  })

  describe('slug', () => {
    const slugBox = () => document.querySelector('.ed-slug-input') as HTMLInputElement
    const apply = () => fireEvent.click(screen.getByRole('button', { name: 'تغيير الرابط' }))
    const applyAnswering = async (ok: boolean) => {
      apply()
      await answerConfirm(ok)
    }

    it('shows the host prefix and the current link', () => {
      ui(<DataPanel />)
      expect(document.querySelector('.ed-slug-prefix')?.textContent).toBe('example.test/i/')
      expect(slugBox().value).toBe('laila-ahmed')
      expect(document.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('https://example.test/i/laila-ahmed/')
    })

    it('does not touch the real link while typing, and cleans the draft on blur', () => {
      ui(<DataPanel />)
      fireEvent.change(slugBox(), { target: { value: 'New Link' } })
      expect(slugBox().value).toBe('New Link')
      expect(s().fields?.slug).toBe('laila-ahmed')
      expect(s().saveStatus).toBe('saved')
      fireEvent.blur(slugBox())
      expect(slugBox().value).toBe('new-link')
      expect(s().fields?.slug).toBe('laila-ahmed')
    })

    it('refuses a link shorter than 3 characters and says it is already the current one', () => {
      ui(<DataPanel />)
      fireEvent.change(slugBox(), { target: { value: 'ab' } })
      apply()
      expect(screen.getByText(/٣ حروف إنجليزي/)).toBeInTheDocument()
      fireEvent.change(slugBox(), { target: { value: 'Laila-Ahmed' } })
      apply()
      expect(screen.getByText('ده نفس الرابط الحالي.')).toBeInTheDocument()
      expect(save).not.toHaveBeenCalled()
    })

    it('does nothing when the confirmation is declined', async () => {
      ui(<DataPanel />)
      fireEvent.change(slugBox(), { target: { value: 'fresh-link' } })
      apply()
      expect(await screen.findByRole('alertdialog')).toHaveTextContent('fresh-link')
      await answerConfirm(false)
      expect(s().fields?.slug).toBe('laila-ahmed')
      expect(save).not.toHaveBeenCalled()
    })

    it('saves right away once confirmed and shows the link the server returned', async () => {
      save.mockResolvedValue({
        savedAt: '10:00:00', slug: 'fresh-link', status: 'draft',
        publicUrl: 'https://example.test/i/fresh-link/', clientFollowupUrl: 'https://example.test/client/xyz/',
      })
      ui(<DataPanel />)
      fireEvent.change(slugBox(), { target: { value: 'Fresh Link' } })
      await applyAnswering(true)
      await waitFor(() => expect(screen.getByText('اتغيّر رابط الدعوة.')).toBeInTheDocument())
      expect(save.mock.calls[0][3]).toMatchObject({ slug: 'fresh-link' })
      expect(s().fields?.slug).toBe('fresh-link')
      expect(s().meta?.publicUrl).toBe('https://example.test/i/fresh-link/')
      expect(slugBox().value).toBe('fresh-link')
      expect(document.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('https://example.test/i/fresh-link/')
    })

    it('puts the old link back and shows the server error when the new one is rejected', async () => {
      save.mockRejectedValue(new ApiError(400, 'validation_error', 'تحقق', { slug: 'الرابط ده مستخدم في دعوة تانية.' }))
      ui(<DataPanel />)
      fireEvent.change(slugBox(), { target: { value: 'taken' } })
      await applyAnswering(true)
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('الرابط ده مستخدم في دعوة تانية.'))
      // الرابط المرفوض ماينفعش يفضل في الستور وإلا كل حفظة جاية هتفشل بسببه
      expect(s().fields?.slug).toBe('laila-ahmed')
      expect(slugBox().value).toBe('laila-ahmed')
      // ومفيش تعديلات غير محفوظة: ماينفعش تظهر «غير محفوظ» ولا يطلع تحذير الخروج
      expect(s().saveStatus).toBe('saved')
    })

    it('keeps the unsaved marker when other edits were already waiting to be saved', async () => {
      save.mockRejectedValue(new ApiError(400, 'validation_error', 'تحقق', { slug: 'محجوز' }))
      ui(<DataPanel />)
      fireEvent.change(input('nameOne'), { target: { value: 'سارة' } })
      fireEvent.change(slugBox(), { target: { value: 'taken' } })
      await applyAnswering(true)
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('محجوز'))
      expect(s().saveStatus).not.toBe('saved')
      expect(s().fields?.nameOne).toBe('سارة')
    })

    it('waits for a save already in flight instead of dropping the change', async () => {
      let finishFirst: (value: Awaited<ReturnType<typeof postSave>>) => void = () => {}
      save.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      save.mockResolvedValueOnce({
        savedAt: '10:00:05', slug: 'later-link', status: 'draft',
        publicUrl: 'https://example.test/i/later-link/', clientFollowupUrl: '',
      })
      ui(<DataPanel />)
      useEditor.setState({ saveStatus: 'dirty' })
      act(() => {
        void s().save() // حفظة تلقائية شغالة
      })
      fireEvent.change(slugBox(), { target: { value: 'later-link' } })
      await applyAnswering(true)
      await act(async () => {
        finishFirst({ savedAt: '10:00:01', slug: 'laila-ahmed', status: 'draft', publicUrl: '', clientFollowupUrl: '' })
      })
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      expect(save.mock.calls[1][3]).toMatchObject({ slug: 'later-link' })
    })

    it('copies the public link', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      ui(<DataPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'نسخ' }))
      await waitFor(() => expect(screen.getByText('اتنسخ الرابط.')).toBeInTheDocument())
      expect(writeText).toHaveBeenCalledWith('https://example.test/i/laila-ahmed/')
    })
  })

  it('offers the client follow-up link: copy and open', () => {
    ui(<DataPanel />)
    const link = screen.getByRole('link', { name: 'فتح صفحة المتابعة' })
    expect(link).toHaveAttribute('href', 'https://example.test/client/xyz/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: 'نسخ الرابط' })).toBeEnabled()
  })
})
