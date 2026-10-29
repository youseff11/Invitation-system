import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { initI18n } from '@/i18n'

import '../fields'
import { answerConfirm } from '../confirmTestUtil'
import { newListItem } from '../fields/ListField'
import { resetEditor, useEditor } from '../store'
import type { BlockSpec, Bootstrap, DocBlock, EditorSchema, FieldSpec } from '../types'
import { EditorUiProvider } from '../ui'
import { BlocksPanel } from './BlocksPanel'
import { InspectorPanel } from './InspectorPanel'

const field = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'type'>): FieldSpec => ({
  label: over.key,
  default: '',
  group: 'المحتوى',
  ...over,
})

const rows = field({
  key: 'rows',
  type: 'list',
  label: 'الصفوف',
  add_label: 'إضافة صف',
  default: [],
  fields: [field({ key: 'label', type: 'text', label: 'العنوان', default: 'جديد' }), field({ key: 'value', type: 'text', default: '' })],
})

const textSpec: BlockSpec = {
  type: 'text',
  label: 'قسم نصي',
  icon: 'T',
  description: 'نص حر',
  category: 'أساسي',
  feature: '',
  singleton: false,
  props: [
    field({ key: 'heading', type: 'text', label: 'العنوان' }),
    field({ key: 'size', type: 'range', label: 'الحجم', default: 30, min: 10, max: 60, unit: 'px' }),
    field({ key: 'italic', type: 'toggle', label: 'مائل', default: false }),
    field({ key: 'hidden_field', type: 'text', editor_hidden: true }),
    field({ key: 'tone', type: 'select', label: 'النبرة', options: [{ value: 'a', label: 'ألف' }, { value: 'b', label: 'باء' }] }),
    rows,
  ],
  style: [field({ key: 'bg_color', type: 'color', label: 'لون الخلفية', group: 'التنسيق' })],
}

const gatedSpec: BlockSpec = { ...textSpec, type: 'gallery', label: 'معرض', feature: 'gallery', singleton: true, props: [], style: [] }

const schema = {
  version: 1,
  blocks: { text: textSpec, gallery: gatedSpec },
  theme_fields: [],
  settings_fields: [],
  fonts: [],
  animations: [],
  dividers: [],
  layout_max: { x: 1000, y: 1000 },
} as EditorSchema

const block = (id: string, type = 'text', over: Partial<DocBlock> = {}): DocBlock => ({
  id, type, visible: true, locked: false, props: { heading: 'مرحباً', size: 30, rows: [] }, style: {}, ...over,
})

const boot = (blocks: DocBlock[], features: string[] = []): Bootstrap => ({
  mode: 'invitation', id: 1, title: 't',
  document: { version: 1, theme: {}, settings: {}, blocks },
  fields: null, features, assets: [], fonts: [], intros: [], music: [], categories: [],
  meta: { slug: 's', status: 'draft', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
})

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditorUiProvider>{node}</EditorUiProvider>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => {
  resetEditor()
  useEditor.getState().load(boot([block('a'), block('b'), block('c', 'gallery')]))
})

describe('BlocksPanel', () => {
  it('lists the sections by custom label or type name and flags the ones outside the plan', () => {
    useEditor.getState().rename('a', 'الترحيب')
    mount(<BlocksPanel schema={schema} />)
    const names = [...document.querySelectorAll('.ed-block-name')].map((n) => n.textContent)
    expect(names).toEqual(['الترحيب', 'قسم نصي', 'معرض'])
    expect(document.querySelectorAll('.ed-block-tag')).toHaveLength(1)
  })

  it('selects on click, and hides / duplicates through the row buttons', () => {
    mount(<BlocksPanel schema={schema} />)
    const rowB = document.querySelector('[data-id="b"]') as HTMLElement
    fireEvent.click(rowB)
    expect(useEditor.getState()).toMatchObject({ selected: 'b', tab: 'inspector' })

    fireEvent.click(within(rowB).getByTitle('إخفاء القسم'))
    expect(useEditor.getState().doc.blocks[1].visible).toBe(false)
    expect(document.querySelector('[data-id="b"]')?.className).toContain('is-hidden')

    fireEvent.click(within(document.querySelector('[data-id="b"]') as HTMLElement).getByTitle('تكرار القسم'))
    expect(useEditor.getState().doc.blocks).toHaveLength(4)
  })

  it('does not duplicate a singleton and says why', () => {
    mount(<BlocksPanel schema={schema} />)
    fireEvent.click(within(document.querySelector('[data-id="c"]') as HTMLElement).getByTitle('تكرار القسم'))
    expect(useEditor.getState().doc.blocks).toHaveLength(3)
    expect(screen.getByText('هذا القسم لا يمكن تكراره.')).toBeInTheDocument()
  })

  it('asks before deleting and deletes only when confirmed', async () => {
    mount(<BlocksPanel schema={schema} />)
    const del = () => within(document.querySelector('[data-id="a"]') as HTMLElement).getByTitle('حذف القسم')
    fireEvent.click(del())
    await answerConfirm(false)
    expect(useEditor.getState().doc.blocks).toHaveLength(3)
    fireEvent.click(del())
    await answerConfirm(true)
    expect(useEditor.getState().doc.blocks.map((b) => b.id)).toEqual(['b', 'c'])
  })

  it('opens the picker, disables an existing singleton and adds a section after the selection', () => {
    useEditor.getState().select('a', 'preview')
    mount(<BlocksPanel schema={schema} />)
    fireEvent.click(screen.getByText('＋ إضافة قسم'))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('معرض').closest('button')).toBeDisabled()
    fireEvent.click(dialog.getByText('قسم نصي').closest('button')!)
    const ids = useEditor.getState().doc.blocks.map((b) => b.id)
    expect(ids).toHaveLength(4)
    expect(ids[1]).toMatch(/^text-/)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('InspectorPanel', () => {
  it('asks for a selection first', () => {
    mount(<InspectorPanel schema={schema} />)
    expect(screen.getByText(/اختر قسماً من القائمة/)).toBeInTheDocument()
  })

  it('builds groups from the schema and skips editor-hidden fields', () => {
    useEditor.getState().select('a')
    mount(<InspectorPanel schema={schema} />)
    // مجموعة المحتوى + التنسيق + «مواضع النصوص» (دايماً موجودة وفيها التلميح)
    expect(document.querySelectorAll('details.ed-group > summary')).toHaveLength(3)
    expect(document.querySelector('[data-field-key="heading"]')).not.toBeNull()
    expect(document.querySelector('[data-field-key="hidden_field"]')).toBeNull()
  })

  it('writes text, range, toggle, select and color edits into the block', () => {
    useEditor.getState().select('a')
    mount(<InspectorPanel schema={schema} />)
    const q = (key: string, sel: string) => document.querySelector(`[data-field-key="${key}"] ${sel}`) as HTMLInputElement
    const current = () => useEditor.getState().doc.blocks[0]

    fireEvent.change(q('heading', 'input'), { target: { value: 'أهلاً' } })
    expect(current().props.heading).toBe('أهلاً')

    fireEvent.change(q('size', 'input[type="range"]'), { target: { value: '42' } })
    expect(current().props.size).toBe(42)
    expect(document.querySelector('[data-field-key="size"] label b')?.textContent).toBe('42px')

    fireEvent.click(q('italic', 'input[type="checkbox"]'))
    expect(current().props.italic).toBe(true)

    fireEvent.change(q('tone', 'select'), { target: { value: 'b' } })
    expect(current().props.tone).toBe('b')

    fireEvent.change(q('bg_color', 'input[type="text"]'), { target: { value: '#112233' } })
    expect(current().style.bg_color).toBe('#112233')
  })

  it('renames the block and clears the label when emptied', () => {
    useEditor.getState().select('a')
    mount(<InspectorPanel schema={schema} />)
    const input = screen.getByLabelText('اسم القسم في القائمة')
    fireEvent.change(input, { target: { value: 'ترحيب' } })
    expect(useEditor.getState().doc.blocks[0].label).toBe('ترحيب')
    fireEvent.change(input, { target: { value: '' } })
    expect('label' in useEditor.getState().doc.blocks[0]).toBe(false)
  })

  it('warns about a section outside the plan', () => {
    useEditor.getState().select('c')
    mount(<InspectorPanel schema={schema} />)
    expect(screen.getByText(/غير متاح في باقة العميل/)).toBeInTheDocument()
  })

  it('edits a repeating list: add, change an item field, reorder, duplicate, delete', () => {
    useEditor.getState().select('a')
    mount(<InspectorPanel schema={schema} />)
    const items = () => (useEditor.getState().doc.blocks[0].props.rows as { label: string }[]).map((r) => r.label)

    fireEvent.click(screen.getByText('＋ إضافة صف'))
    fireEvent.click(screen.getByText('＋ إضافة صف'))
    expect(items()).toEqual(['جديد', 'جديد'])

    const firstCard = () => document.querySelectorAll('.ed-list-item')[0] as HTMLElement
    fireEvent.change(within(firstCard()).getAllByRole('textbox')[0], { target: { value: 'الأول' } })
    expect(items()).toEqual(['الأول', 'جديد'])
    expect(within(firstCard()).getByText('الأول')).toBeInTheDocument() // عنوان الكارت

    fireEvent.click(within(firstCard()).getByTitle('لأسفل'))
    expect(items()).toEqual(['جديد', 'الأول'])
    fireEvent.click(within(firstCard()).getByTitle('تكرار'))
    expect(items()).toEqual(['جديد', 'جديد', 'الأول'])
    fireEvent.click(within(firstCard()).getByTitle('حذف'))
    expect(items()).toEqual(['جديد', 'الأول'])
  })
})

describe('newListItem', () => {
  it('seeds defaults and the chosen variant, without sharing references', () => {
    const spec = field({
      key: 'items', type: 'list', default: [],
      fields: [field({ key: 'kind', type: 'select', default: 'text' }), field({ key: 'tags', type: 'list', default: [] })],
    })
    const a = newListItem(spec, { key: 'kind', value: 'image', label: 'صورة', seed: { src: '' } })
    const b = newListItem(spec)
    expect(a).toEqual({ kind: 'image', tags: [], src: '' })
    expect(b).toEqual({ kind: 'text', tags: [] })
    expect(a.tags).not.toBe(b.tags)
  })
})
