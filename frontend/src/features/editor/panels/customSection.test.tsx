import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'

import '../fields'
import { OverlayButtons } from '../frame/OverlayButtons'
import { hasCountdown } from '../imported/units'
import { resetEditor, useEditor } from '../store'
import type { BlockSpec, Bootstrap, DocBlock, EditorSchema, FieldSpec } from '../types'
import { EditorUiProvider } from '../ui'
import { InspectorPanel } from './InspectorPanel'

const field = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'type'>): FieldSpec => ({
  label: over.key,
  default: '',
  group: '',
  ...over,
})

const overlays = field({
  key: 'text_overlays',
  type: 'list',
  label: 'عناصر فوق القسم',
  group: 'عناصر فوق القسم',
  default: [],
  fields: [field({ key: 'kind', type: 'select', default: 'text', editor_hidden: true }), field({ key: 'text', type: 'textarea', label: 'النص' })],
  add_variants: [
    { key: 'kind', value: 'text', label: '＋ نص', seed: { text: 'اكتب النص هنا' } },
    { key: 'kind', value: 'image', label: '＋ صورة', seed: {} },
    { key: 'kind', value: 'button', label: '＋ زرار', seed: {} },
  ],
})

const customSpec: BlockSpec = {
  type: 'custom_html',
  label: 'كود HTML مخصص',
  icon: '</>',
  description: '',
  category: 'متقدم',
  feature: '',
  singleton: false,
  props: [
    field({ key: 'html', type: 'html', group: 'كود متقدّم', editor_hidden: true }),
    field({ key: 'countdown_date', type: 'text', label: 'موعد العدّاد', group: 'إعدادات العداد' }),
    overlays,
    field({ key: 'code', type: 'textarea', label: 'الكود', group: 'كود متقدّم' }),
  ],
  style: [field({ key: 'bg_color', type: 'color', label: 'لون الخلفية', group: 'التنسيق' })],
}

const schema = {
  version: 1,
  blocks: { custom_html: customSpec },
  theme_fields: [],
  settings_fields: [],
  fonts: [],
  animations: [],
  dividers: [],
  layout_max: { x: 1000, y: 1000 },
} as EditorSchema

vi.mock('../hooks', () => ({ useSchema: () => ({ data: schema }) }))

const block = (props: DocBlock['props'] = {}): DocBlock => ({
  id: 'a', type: 'custom_html', visible: true, locked: false, props: { html: '<h1 data-move="el-1">أحمد</h1>', ...props }, style: {},
})
const boot = (blocks: DocBlock[]): Bootstrap => ({
  mode: 'template', id: 1, title: 't',
  document: { version: 1, theme: {}, settings: {}, blocks },
  fields: null, features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
  meta: { slug: 's', status: '', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
})
const s = () => useEditor.getState()
const mount = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditorUiProvider>{node}</EditorUiProvider>
    </QueryClientProvider>,
  )
const summaries = () => [...document.querySelectorAll('summary')].map((n) => n.textContent)

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  resetEditor()
  s().load(boot([block()]))
  s().select('a', 'preview')
})

describe('hasCountdown', () => {
  it('spots the template countdown markers in class and id attributes only', () => {
    expect(hasCountdown('<div class="t-cd time-block"></div>')).toBe(true)
    expect(hasCountdown("<div id='section-countdown'></div>")).toBe(true)
    expect(hasCountdown('<p>countdown</p><div class="names"></div>')).toBe(false)
  })
})

describe('custom code section inspector', () => {
  it('shows only what the section has: no counter settings, no overlay list, no text positions', () => {
    mount(<InspectorPanel schema={schema} />)
    const names = summaries()
    expect(names).not.toContain('إعدادات العداد')
    expect(names).not.toContain('عناصر فوق القسم')
    expect(names).not.toContain('مواضع النصوص')
    expect(names).toContain('كود متقدّم')
    expect(names).toContain('التنسيق')
  })

  it('opens the code group by default, with the code box ready', () => {
    mount(<InspectorPanel schema={schema} />)
    const group = screen.getByText('كود متقدّم').closest('details') as HTMLDetailsElement
    expect(group.open).toBe(true)
    expect(group.querySelector('textarea')).toBeTruthy()
  })

  it('brings the counter settings in only when the section has a countdown', () => {
    s().setProp('a', 'html', '<div class="time-block"><span class="cd-days">3</span></div>')
    mount(<InspectorPanel schema={schema} />)
    expect(summaries()).toContain('إعدادات العداد')
  })

  it('keeps the overlay list out of the panel even when the section has overlays', () => {
    s().setProp('a', 'text_overlays', [{ kind: 'text', text: 'مرحبا' }])
    mount(<InspectorPanel schema={schema} />)
    expect(summaries()).not.toContain('عناصر فوق القسم')
  })

  it('colors the picked element straight away, and section colors only while nothing is picked', () => {
    mount(<InspectorPanel schema={schema} />)
    expect(summaries()).toContain('ألوان القسم')
    act(() => s().selectElement('a', 'el-1'))
    expect(summaries()).not.toContain('ألوان القسم')
    const colors = document.querySelector('[data-field-key="element-colors"]') as HTMLElement
    expect(colors.querySelectorAll('input[type="color"]').length).toBe(2)
    fireEvent.change(colors.querySelector('input[type="color"]') as HTMLInputElement, { target: { value: '#ff0000' } })
    expect(String(s().doc.blocks[0].props.html)).toMatch(/color:\s*rgb\(255, 0, 0\)/)
  })
})

describe('overlay list in the panel', () => {
  it('never shows on any section type', () => {
    const plain: BlockSpec = { ...customSpec, type: 'text', props: [field({ key: 'heading', type: 'text', group: 'المحتوى' }), overlays] }
    s().load(boot([{ id: 'p', type: 'text', visible: true, locked: false, props: { heading: 'x', text_overlays: [{ kind: 'text', text: 'ا' }] }, style: {} }]))
    s().select('p', 'preview')
    mount(<InspectorPanel schema={{ ...schema, blocks: { ...schema.blocks, text: plain } }} />)
    expect(summaries()).toContain('المحتوى')
    expect(summaries()).not.toContain('عناصر فوق القسم')
  })
})

describe('selected overlay panel', () => {
  beforeEach(() => {
    s().setProp('a', 'text_overlays', [{ kind: 'text', text: 'ا' }, { kind: 'text', text: 'ب' }])
  })

  it('opens the editor for the selected overlay on the inspector tab, and edits write back to it', () => {
    s().setTab('blocks')
    s().selectOverlay('a', 1)
    expect(s().tab).toBe('inspector')
    mount(<InspectorPanel schema={schema} />)
    const box = document.querySelector('.ed-overlay-panel textarea') as HTMLTextAreaElement
    expect(box.value).toBe('ب')
    fireEvent.change(box, { target: { value: 'جديد' } })
    expect(s().doc.blocks[0].props.text_overlays).toEqual([
      { kind: 'text', text: 'ا' },
      { kind: 'text', text: 'جديد' },
    ])
  })

  it('shows nothing until an overlay is selected, and delete / done close it', () => {
    mount(<InspectorPanel schema={schema} />)
    expect(document.querySelector('.ed-overlay-panel')).toBeNull()
    act(() => s().selectOverlay('a', 0))
    fireEvent.click(screen.getByRole('button', { name: 'حذف العنصر' }))
    expect(s().doc.blocks[0].props.text_overlays).toEqual([{ kind: 'text', text: 'ب' }])
    expect(document.querySelector('.ed-overlay-panel')).toBeNull()
  })
})

describe('OverlayButtons (preview bar)', () => {
  it('adds a text, image or button on top of the selected section', () => {
    mount(<OverlayButtons />)
    fireEvent.click(screen.getByRole('button', { name: '＋ نص' }))
    fireEvent.click(screen.getByRole('button', { name: '＋ زرار' }))
    expect(s().doc.blocks[0].props.text_overlays).toEqual([
      { kind: 'text', text: 'اكتب النص هنا' },
      { kind: 'button' },
    ].map((item) => expect.objectContaining(item)))
  })

  it('is off until a section is selected', () => {
    s().select(null, 'preview')
    mount(<OverlayButtons />)
    expect((screen.getByRole('button', { name: '＋ صورة' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('overlay selection', () => {
  beforeEach(() => {
    s().setProp('a', 'text_overlays', [{ kind: 'text', text: 'ا' }, { kind: 'text', text: 'ب' }])
  })

  it('selecting an overlay keeps the section selected and clears the picked element', () => {
    s().selectElement('a', 'el-1')
    s().selectOverlay('a', 1)
    expect(s()).toMatchObject({ selected: 'a', selEl: null, selOverlay: { blockId: 'a', index: 1 } })
    s().select('a', 'preview') // الضغطة نفسها بتبعت تحديد القسم كمان
    expect(s().selOverlay).toEqual({ blockId: 'a', index: 1 })
    s().selectElement('a', 'el-1')
    expect(s().selOverlay).toBeNull()
  })

  it('removeOverlay deletes only the selected overlay, in one undo step', () => {
    s().selectOverlay('a', 0)
    s().removeOverlay()
    expect(s().doc.blocks[0].props.text_overlays).toEqual([{ kind: 'text', text: 'ب' }])
    expect(s().selOverlay).toBeNull()
    s().undo()
    expect(s().doc.blocks[0].props.text_overlays).toHaveLength(2)
  })

  it('duplicateOverlay copies the selected overlay below the original, selects the copy, in one undo step', () => {
    s().setProp('a', 'text_overlays', [{ kind: 'text', text: 'ا', color: '#f00', y: 10 }, { kind: 'text', text: 'ب' }])
    s().selectOverlay('a', 0)
    s().duplicateOverlay()
    const list = s().doc.blocks[0].props.text_overlays as Array<Record<string, unknown>>
    expect(list.map((o) => o.text)).toEqual(['ا', 'ا', 'ب'])
    expect(list[1]).toMatchObject({ color: '#f00', y: 14 })
    expect(list[0].y).toBe(10)
    expect(s().selOverlay).toEqual({ blockId: 'a', index: 1 })
    s().undo()
    expect(s().doc.blocks[0].props.text_overlays).toHaveLength(2)
  })

  it('drops the selection when undo makes its index disappear', () => {
    s().setProp('a', 'text_overlays', [])
    s().selectOverlay('a', 0)
    s().undo()
    s().redo()
    expect(s().selOverlay).toBeNull()
  })
})
