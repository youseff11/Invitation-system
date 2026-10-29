import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'

import { resetEditor, useEditor } from '../store'
import type { Bootstrap, PreviewPayload } from '../types'
import { EditorUiProvider } from '../ui'
import { IntroButton } from './IntroButton'
import { useIntroBus } from './introBus'
import { PreviewPane, PREVIEW_WAIT } from './PreviewPane'

vi.mock('../api', () => ({ fetchPreview: vi.fn() }))
import { fetchPreview } from '../api'

const preview = vi.mocked(fetchPreview)

const boot = (over: Partial<Bootstrap> = {}): Bootstrap => ({
  mode: 'invitation',
  id: 5,
  title: 't',
  document: { version: 1, theme: {}, settings: { intro_enabled: false }, blocks: [] },
  fields: {
    title: '', eventType: '', nameOne: 'ليلى', nameTwo: 'أحمد', eventDate: '', venue: '',
    address: '', mapUrl: '', whatsapp: '', status: 'draft', expiresAt: '', password: '', slug: 'laila',
  },
  features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
  meta: { slug: 'laila', status: 'draft', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  ...over,
})

function mount() {
  const view = render(
    <EditorUiProvider>
      <IntroButton />
      <PreviewPane onKey={() => {}} />
    </EditorUiProvider>,
  )
  const iframe = view.container.querySelector('iframe') as HTMLIFrameElement
  const ready = () =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'lb-editor:ready' }, origin: window.location.origin, source: iframe.contentWindow }),
      )
    })
  return { iframe, ready }
}

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  resetEditor()
  preview.mockReset()
  preview.mockResolvedValue({ blocks: [] } as unknown as PreviewPayload)
  useEditor.getState().load(boot())
})
afterEach(() => vi.restoreAllMocks())

describe('PreviewPane', () => {
  it('asks for the first preview with the unsaved event fields once the frame is ready', async () => {
    const { ready } = mount()
    ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const [mode, id, doc, lang, signal, fields] = preview.mock.calls[0]
    expect([mode, id, lang]).toEqual(['invitation', 5, ''])
    expect(doc).toBe(useEditor.getState().doc)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(fields).toMatchObject({ nameOne: 'ليلى', nameTwo: 'أحمد' })
  })

  it('refreshes with the new name as soon as the event data is edited (before any save)', async () => {
    const { ready } = mount()
    ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))

    act(() => useEditor.getState().setEventField('nameOne', 'سارة'))
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2), { timeout: PREVIEW_WAIT * 6 })
    expect(preview.mock.calls[1][5]).toMatchObject({ nameOne: 'سارة', nameTwo: 'أحمد' })
    expect(useEditor.getState().saveStatus).toBe('dirty') // لسه مااتحفظش
  })

  it('shows an undone/redone version at once from the earlier render, without asking the server again', async () => {
    const { iframe, ready } = mount()
    ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const original = { blocks: [], tag: 'original' } as unknown as PreviewPayload
    preview.mockResolvedValue(original)
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage')

    act(() => useEditor.getState().setSetting('intro_enabled', true))
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2), { timeout: PREVIEW_WAIT * 6 })
    await waitFor(() => expect(post).toHaveBeenCalled())
    post.mockClear()

    act(() => useEditor.getState().undo())
    // نفس اللحظة: مفيش وقفة ولا طلب جديد، والرسمة الأولى اتبعتت للإطار
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'lb-editor:render' }), window.location.origin)
    expect(preview).toHaveBeenCalledTimes(2)

    post.mockClear()
    act(() => useEditor.getState().redo())
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'lb-editor:render' }), window.location.origin)
    expect(preview).toHaveBeenCalledTimes(2)
  })

  it('undoes at once even after quick unsaved edits, because the history versions are rendered in the background', async () => {
    const { iframe, ready } = mount()
    ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage')

    // ٣ تعديلات ورا بعض أسرع من وقفة المعاينة: النسخ الوسيطة ماتعرضتش
    act(() => useEditor.getState().setSetting('intro_enabled', true))
    act(() => useEditor.getState().setSetting('music_volume', 0.5))
    act(() => useEditor.getState().setSetting('music_autoplay', true))
    expect(useEditor.getState().saveStatus).toBe('dirty')

    // بعد ما تسكت: رسمة النسخة الأخيرة + تجهيز النسختين اللي قبلها
    await waitFor(() => expect(preview.mock.calls.length).toBeGreaterThanOrEqual(4), { timeout: PREVIEW_WAIT * 10 })
    const asked = preview.mock.calls.length
    post.mockClear()

    act(() => useEditor.getState().undo())
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'lb-editor:render' }), window.location.origin)
    act(() => useEditor.getState().undo())
    expect(post).toHaveBeenCalledTimes(2)
    expect(preview.mock.calls.length).toBe(asked) // لا طلب جديد للسيرفر
    expect(useEditor.getState().saveStatus).toBe('dirty') // وكله لسه غير محفوظ
  })

  it('sends no event fields for a template', async () => {
    resetEditor()
    useEditor.getState().load(boot({ mode: 'template', fields: null }))
    const { ready } = mount()
    ready()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    expect(preview.mock.calls[0][0]).toBe('template')
    expect(preview.mock.calls[0][5]).toBeNull()
  })

  it('forwards the intro button to the frame, but only when the intro is turned on', async () => {
    const { iframe, ready } = mount()
    ready()
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage')

    fireEvent.click(screen.getByRole('button', { name: 'الافتتاحية' }))
    expect(screen.getByText(/فعّل «شاشة افتتاحية»/)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalledWith({ type: 'lb-editor:intro' }, expect.anything())

    act(() => useEditor.getState().setSetting('intro_enabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'الافتتاحية' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'lb-editor:intro' }, window.location.origin))
    expect(useIntroBus.getState().count).toBeGreaterThan(0)
  })

  it('shows a skip button only while the frame says the intro covers the preview, and forwards the click', async () => {
    const { iframe, ready } = mount()
    ready()
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage')
    const fromFrame = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: iframe.contentWindow }))
      })
    const skip = () => screen.queryByRole('button', { name: 'تخطّي الافتتاحية' })

    expect(skip()).toBeNull()
    fromFrame({ type: 'lb-editor:intro-visible', visible: true })
    fireEvent.click(skip()!)
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'lb-editor:intro-skip' }, window.location.origin))

    fromFrame({ type: 'lb-editor:intro-visible', visible: false })
    expect(skip()).toBeNull()
  })
})
