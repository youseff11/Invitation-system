import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { block, intro } from '@/features/invite/fixtures'
import type { IntroData } from '@/features/invite/types'

import type { PreviewPayload } from '../types'
import { FrameApp } from './FrameApp'

const preview = (introData: IntroData | null): PreviewPayload => ({
  kind: 'invitation',
  editable: true,
  lang: 'ar',
  dir: 'rtl',
  hasAlt: false,
  altLang: 'en',
  baseLang: 'ar',
  maxWidth: 760,
  bodyStyle: '--bg:#fff',
  css: { font: '', layout: '', shared: '', zero: '' },
  fontPreloads: [],
  stage: { runtime: false, rootAttrs: {}, full: false, pattern: '' },
  showBranding: false,
  intro: introData,
  blocks: [block('quote', { text: 'اقتباس', source: '' }, { id: 'q1', attrs: { id: 'q1', className: 'lb lb--quote', style: '' } })],
  runtimeScripts: [],
  runtimeIsSpa: false,
  guest: null,
  siteName: 'T DESIGNATION',
  siteUrl: '/',
})

function fromParent(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }))
  })
}
const render_ = (introData: IntroData | null) => fromParent({ type: 'lb-editor:render', selected: null, payload: preview(introData) })

describe('FrameApp intro screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    document.body.style.overflow = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const introEl = (container: HTMLElement) => container.querySelector('.lb-intro')

  it('draws payload.intro above the stage, with the same blocks below', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'تشرّفنا بدعوتكم', button: 'افتح الدعوة' }))
    expect(introEl(container)).not.toBeNull()
    expect(introEl(container)?.textContent).toContain('تشرّفنا بدعوتكم')
    expect(container.querySelector('[data-block="q1"]')).not.toBeNull()
  })

  it('draws no intro when the settings have it off', () => {
    const { container } = render(<FrameApp />)
    render_(null)
    expect(introEl(container)).toBeNull()
    expect(container.querySelector('[data-block="q1"]')).not.toBeNull()
  })

  it('follows edits to the intro while it is still showing', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'أول نص' }))
    render_(intro({ text: 'نص معدّل' }))
    expect(introEl(container)?.textContent).toContain('نص معدّل')
    expect(container.querySelectorAll('.lb-intro')).toHaveLength(1)
  })

  it('stays closed once opened, even when the intro is edited afterwards', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'أول نص' }))
    fireEvent.click(container.querySelector('[data-intro-open]')!, { detail: 3 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(introEl(container)).toBeNull()

    render_(intro({ text: 'نص معدّل' }))
    expect(introEl(container)).toBeNull()
  })

  it('shows it again on the intro message, with the latest content', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'أول نص' }))
    fireEvent.click(container.querySelector('[data-intro-open]')!, { detail: 3 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    render_(intro({ text: 'نص معدّل' }))

    fromParent({ type: 'lb-editor:intro' })
    expect(introEl(container)?.textContent).toContain('نص معدّل')
    expect(introEl(container)?.classList.contains('is-open')).toBe(false)

    // ولما تتفتح تاني وتتعدّل، برضو مابترجعش لوحدها
    fireEvent.click(container.querySelector('[data-intro-open]')!, { detail: 3 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    render_(intro({ text: 'تعديل تالت' }))
    expect(introEl(container)).toBeNull()
  })

  it('turning the intro off and on again brings it back', () => {
    const { container } = render(<FrameApp />)
    render_(intro())
    fireEvent.click(container.querySelector('[data-intro-open]')!, { detail: 3 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    render_(null)
    render_(intro({ text: 'رجعت' }))
    expect(introEl(container)?.textContent).toContain('رجعت')
  })

  it('does not select a block when the intro is tapped', () => {
    const posted: unknown[] = []
    vi.mocked(window.parent.postMessage).mockImplementation((message: unknown) => {
      posted.push(message)
    })
    const { container } = render(<FrameApp />)
    render_(intro())
    posted.length = 0
    fireEvent.click(introEl(container)!)
    expect(posted.filter((m) => (m as { type: string }).type === 'lb-editor:select')).toEqual([])
  })

  it('opens the invitation on the skip message, and tells the parent when the intro is covering the preview', () => {
    const posted: unknown[] = []
    vi.mocked(window.parent.postMessage).mockImplementation((message: unknown) => {
      posted.push(message)
    })
    const visible = () => posted.filter((m) => (m as { type: string }).type === 'lb-editor:intro-visible').at(-1)
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'نص', button: 'ابدأ' }))
    expect(visible()).toEqual({ type: 'lb-editor:intro-visible', visible: true })

    fromParent({ type: 'lb-editor:intro-skip' })
    expect(visible()).toEqual({ type: 'lb-editor:intro-visible', visible: false })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(introEl(container)).toBeNull()

    fromParent({ type: 'lb-editor:intro' })
    expect(visible()).toEqual({ type: 'lb-editor:intro-visible', visible: true })
  })

  it('skip with no intro showing does nothing', () => {
    const { container } = render(<FrameApp />)
    render_(null)
    fromParent({ type: 'lb-editor:intro-skip' })
    expect(introEl(container)).toBeNull()
    expect(container.querySelector('[data-block="q1"]')).not.toBeNull()
  })

  it('ignores the intro message when there is nothing to show', () => {
    const { container } = render(<FrameApp />)
    render_(null)
    fromParent({ type: 'lb-editor:intro' })
    expect(introEl(container)).toBeNull()
  })
})

describe('FrameApp intro clicks in the editor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    document.body.style.overflow = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const sentToParent = () => vi.mocked(window.parent.postMessage).mock.calls.map((call) => call[0] as { type: string; key?: string; value?: string })

  it('one click does not skip the intro', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'نص', button: 'ابدأ' }))
    fireEvent.click(container.querySelector('[data-intro-open]')!, { detail: 1 })
    fireEvent.click(container.querySelector('.lb-intro')!, { detail: 1 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('.lb-intro')).not.toBeNull()
    expect(container.querySelector('.lb-intro')?.classList.contains('is-open')).toBe(false)
  })

  it('two clicks edit the button text in place and Enter saves it to the intro setting', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'نص', button: 'ابدأ' }))
    const button = container.querySelector<HTMLElement>('[data-intro-open]')!
    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })
    expect(button.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(container.querySelector('.lb-intro')?.classList.contains('is-open')).toBe(false)

    button.textContent = 'يلا نبدأ'
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(button.hasAttribute('contenteditable')).toBe(false)
    expect(sentToParent()).toContainEqual({ type: 'lb-editor:intro-text', key: 'intro_button', value: 'يلا نبدأ' })
  })

  it('Escape cancels the edit, and an empty text is not saved', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'نص', button: 'ابدأ' }))
    const button = container.querySelector<HTMLElement>('[data-intro-open]')!
    fireEvent.click(button, { detail: 2 })
    button.textContent = 'حاجة تانية'
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(button.textContent).toBe('ابدأ')

    fireEvent.click(button, { detail: 2 })
    button.textContent = '   '
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(button.textContent).toBe('ابدأ')
    expect(sentToParent().some((m) => m.type === 'lb-editor:intro-text')).toBe(false)
  })

  it('the paragraph text is editable too, and three clicks skip the intro', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ text: 'نص', button: 'ابدأ' }))
    const text = container.querySelector<HTMLElement>('[data-intro-item="text"]')!
    fireEvent.click(text, { detail: 2 })
    text.textContent = 'نص جديد'
    fireEvent.click(text, { detail: 3 }) // التالتة: بتحفظ وبتفتح
    expect(sentToParent()).toContainEqual({ type: 'lb-editor:intro-text', key: 'intro_text', value: 'نص جديد' })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('.lb-intro')).toBeNull()
  })

  it('refuses editing while the translated preview is showing', () => {
    const { container } = render(<FrameApp />)
    fromParent({ type: 'lb-editor:render', selected: null, payload: { ...preview(intro({ button: 'ابدأ' })), lang: 'en', baseLang: 'ar' } })
    const button = container.querySelector<HTMLElement>('[data-intro-open]')!
    fireEvent.click(button, { detail: 2 })
    expect(button.hasAttribute('contenteditable')).toBe(false)
    expect(sentToParent()).toContainEqual({ type: 'lb-editor:refused' })
  })

  it('the video play button: one click does nothing, two edit its label, three open the invitation', () => {
    const { container } = render(<FrameApp />)
    render_(intro({ video: '/v.mp4', playMode: 'button', playLabel: 'ابدأ الفيديو' }))
    const play = container.querySelector<HTMLElement>('[data-intro-play]')!
    fireEvent.click(play, { detail: 1 })
    expect(container.querySelector('.lb-intro')?.classList.contains('is-open')).toBe(false)

    const label = container.querySelector<HTMLElement>('.lb-intro-play-text') ?? play
    fireEvent.click(label, { detail: 2 })
    expect(label.getAttribute('contenteditable')).toBe('plaintext-only')
    label.textContent = 'شغّل'
    fireEvent.keyDown(label, { key: 'Enter' })
    expect(sentToParent()).toContainEqual({ type: 'lb-editor:intro-text', key: 'intro_play_label', value: 'شغّل' })

    fireEvent.click(play, { detail: 3 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('.lb-intro')).toBeNull()
  })
})
