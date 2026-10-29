import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'

import { FieldGroups } from '../panels/FieldGroups'
import { resetEditor } from '../store'
import type { FieldSpec } from '../types'
import { EditorUiProvider } from '../ui'
import './index'
import { gearFor } from './textStyle'
import { buildStyleIndex, textStyleChildren } from './textStyleIndex'

// حقل الخط بيقرا قايمة خطوط السكيما من الـAPI — مالوش لازمة هنا
vi.mock('../hooks', () => ({ useSchema: () => ({ data: undefined }) }))

const field = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'type'>): FieldSpec => ({
  label: over.key,
  default: '',
  group: 'المحتوى',
  ...over,
})

/** حقل نص + حقول تنسيقه المخفية بترتيب مقلوب عن ترتيب الأدوار */
const specs: FieldSpec[] = [
  field({ key: 'heading', type: 'text', label: 'العنوان' }),
  field({ key: 'ts_heading_lh', type: 'range', label: 'ارتفاع السطر', editor_hidden: true, style_of: 'heading', style_role: 'lh', min: 1, max: 3 }),
  field({ key: 'ts_heading_color', type: 'color', label: 'لون النص', editor_hidden: true, style_of: 'heading', style_role: 'color' }),
  field({ key: 'ts_heading_size', type: 'range', label: 'الحجم', editor_hidden: true, style_of: 'heading', style_role: 'size', min: 8, max: 90 }),
  field({ key: 'ts_heading_font', type: 'font', label: 'الخط', editor_hidden: true, style_of: 'heading', style_role: 'font' }),
  field({ key: 'ts_heading_extra', type: 'range', label: 'إضافي', editor_hidden: true, style_of: 'heading', style_role: 'zz_extra' }),
  field({ key: 'plain', type: 'text', label: 'نص بلا تنسيق' }),
  field({ key: 'count', type: 'number', label: 'العدد' }),
  field({ key: 'ts_count_size', type: 'range', label: 'حجم العدد', editor_hidden: true, style_of: 'count', style_role: 'size' }),
]

function mount(values: Record<string, unknown>, set: (spec: FieldSpec, value: unknown) => void) {
  // حقل الخط بقى فيه «رفع خط جديد» (C3) وده محتاج مزوّد تنبيهات المحرر
  return render(
    <EditorUiProvider>
      <FieldGroups specs={specs} get={(spec) => values[spec.key]} set={set} open={{}} onToggle={() => {}} />
    </EditorUiProvider>,
  )
}

beforeAll(() => {
  initI18n('ar')
})
beforeEach(() => resetEditor())

describe('text style index', () => {
  it('groups the style fields by the text they format, in role order', () => {
    const index = buildStyleIndex(specs)
    const heading = specs[0]
    expect(textStyleChildren(index, heading).map((s) => s.key)).toEqual([
      'ts_heading_font',
      'ts_heading_color',
      'ts_heading_size',
      'ts_heading_lh',
      'ts_heading_extra',
    ])
  })

  it('gives a gear only to text-like fields that have style fields', () => {
    const index = buildStyleIndex(specs)
    expect(textStyleChildren(index, specs[0])).toHaveLength(5)
    expect(textStyleChildren(index, specs.find((s) => s.key === 'plain')!)).toEqual([])
    // رقم له حقل تنسيق، بس الترس لنصوص بس
    expect(textStyleChildren(index, specs.find((s) => s.key === 'count')!)).toEqual([])
    expect(gearFor(specs[0], { index, get: () => '', set: () => {} })).toBeTruthy()
    expect(gearFor(specs[6], { index, get: () => '', set: () => {} })).toBeUndefined()
  })
})

describe('text style gear in FieldGroups', () => {
  it('shows a gear next to the styled text only, and keeps style fields out of the group', () => {
    mount({}, () => {})
    expect(document.querySelectorAll('.ed-font-gear')).toHaveLength(1)
    const heading = document.querySelector('[data-field-key="heading"]') as HTMLElement
    expect(heading.querySelector('.ed-text-control-row .ed-font-gear')).not.toBeNull()
    expect(document.querySelector('[data-field-key="plain"] .ed-font-gear')).toBeNull()
    expect(document.querySelector('[data-field-key="ts_heading_color"]')).toBeNull() // مخفي لحد ما يتفتح الترس
  })

  it('opens the panel on click and builds it only then', () => {
    mount({}, () => {})
    const gear = screen.getByRole('button', { name: /تنسيق النص: العنوان/ })
    expect(gear).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.ed-inline-font-panel')).toBeNull()

    fireEvent.click(gear)
    expect(gear).toHaveAttribute('aria-expanded', 'true')
    const panel = document.querySelector('.ed-inline-font-panel') as HTMLElement
    const keys = [...panel.querySelectorAll('[data-field-key]')].map((n) => n.getAttribute('data-field-key'))
    expect(keys).toEqual(['ts_heading_font', 'ts_heading_color', 'ts_heading_size', 'ts_heading_lh', 'ts_heading_extra'])

    fireEvent.click(gear)
    expect(document.querySelector('.ed-inline-font-panel')).toBeNull()
  })

  it('reads from and writes to the style field, not the text field itself', () => {
    const set = vi.fn()
    mount({ heading: 'مرحباً', ts_heading_size: 40 }, set)
    fireEvent.click(screen.getByRole('button', { name: /تنسيق النص: العنوان/ }))
    const panel = within(document.querySelector('.ed-inline-font-panel') as HTMLElement)

    expect((panel.getAllByRole('slider')[0] as HTMLInputElement).value).toBe('40')
    fireEvent.change(panel.getAllByRole('slider')[0], { target: { value: '55' } })
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[0][0].key).toBe('ts_heading_size')
    expect(set.mock.calls[0][1]).toBe(55)

    set.mockClear()
    fireEvent.change(panel.getAllByRole('textbox')[0], { target: { value: '#aa0000' } }) // خانة اللون
    expect(set.mock.calls[0][0].key).toBe('ts_heading_color')
    expect(set.mock.calls[0][1]).toBe('#aa0000')
  })
})
