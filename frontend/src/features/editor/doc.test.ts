import { describe, expect, it } from 'vitest'

import {
  defaultsFor,
  duplicateBlock,
  findBlock,
  insertBlock,
  makeBlock,
  moveBlock,
  removeBlock,
  setBlockLabel,
  setBlockProp,
  setBlockStyle,
  setSetting,
  setTheme,
  toggleVisible,
} from './doc'
import type { BlockSpec, DocBlock, EditorDocument } from './types'

const spec = (type: string): BlockSpec => ({
  type,
  label: type,
  icon: '□',
  description: '',
  category: 'عام',
  feature: '',
  singleton: false,
  props: [
    { key: 'heading', label: 'عنوان', type: 'text', default: 'أهلاً', group: 'المحتوى' },
    { key: 'items', label: 'عناصر', type: 'list', default: [{ a: 1 }], group: 'المحتوى' },
  ],
  style: [{ key: 'padding_top', label: 'مسافة', type: 'range', default: 80, group: 'المسافات' }],
})

const block = (id: string, type = 'text'): DocBlock => ({ id, type, visible: true, locked: false, props: {}, style: {} })
const doc = (...ids: string[]): EditorDocument => ({
  version: 1,
  theme: { bg: '#fff' },
  settings: {},
  blocks: ids.map((id) => block(id)),
})
const ids = (d: EditorDocument) => d.blocks.map((b) => b.id)

describe('makeBlock / defaultsFor', () => {
  it('builds a block from the spec defaults with a typed id', () => {
    const made = makeBlock(spec('quote'))
    expect(made.id).toMatch(/^quote-[a-z0-9]{1,6}$/)
    expect(made).toMatchObject({ type: 'quote', visible: true, locked: false })
    expect(made.props).toEqual({ heading: 'أهلاً', items: [{ a: 1 }] })
    expect(made.style).toEqual({ padding_top: 80 })
  })

  it('does not share list defaults between blocks', () => {
    const a = makeBlock(spec('text'))
    const b = makeBlock(spec('text'))
    ;(a.props.items as { a: number }[])[0].a = 99
    expect((b.props.items as { a: number }[])[0].a).toBe(1)
    expect(defaultsFor(undefined)).toEqual({})
  })

  it('generates different ids', () => {
    const seen = new Set(Array.from({ length: 50 }, () => makeBlock(spec('text')).id))
    expect(seen.size).toBeGreaterThan(45)
  })
})

describe('insert / duplicate / remove', () => {
  it('inserts after the selected block, or at the end', () => {
    expect(ids(insertBlock(doc('a', 'b', 'c'), block('x'), 'a'))).toEqual(['a', 'x', 'b', 'c'])
    expect(ids(insertBlock(doc('a', 'b'), block('x'), null))).toEqual(['a', 'b', 'x'])
    expect(ids(insertBlock(doc('a', 'b'), block('x'), 'missing'))).toEqual(['a', 'b', 'x'])
  })

  it('duplicates right after the source with a new id and a deep copy', () => {
    const source = doc('a', 'b')
    source.blocks[0].props = { items: [{ n: 1 }] }
    const result = duplicateBlock(source, 'a')!
    expect(ids(result.doc)).toEqual(['a', result.id, 'b'])
    expect(result.id).not.toBe('a')
    ;(result.doc.blocks[1].props.items as { n: number }[])[0].n = 2
    expect((source.blocks[0].props.items as { n: number }[])[0].n).toBe(1)
    expect(duplicateBlock(source, 'nope')).toBeNull()
  })

  it('removes a block and leaves the original untouched', () => {
    const before = doc('a', 'b', 'c')
    const after = removeBlock(before, 'b')
    expect(ids(after)).toEqual(['a', 'c'])
    expect(ids(before)).toEqual(['a', 'b', 'c'])
    expect(removeBlock(before, 'nope')).toBe(before)
  })
})

describe('moveBlock', () => {
  it('moves forward and backward to the target position', () => {
    expect(ids(moveBlock(doc('a', 'b', 'c', 'd'), 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(moveBlock(doc('a', 'b', 'c', 'd'), 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('ignores unknown ids and no-op moves', () => {
    const d = doc('a', 'b')
    expect(moveBlock(d, 'a', 'a')).toBe(d)
    expect(moveBlock(d, 'a', 'zzz')).toBe(d)
  })
})

describe('field setters', () => {
  it('toggles visibility without touching other blocks', () => {
    const before = doc('a', 'b')
    const after = toggleVisible(before, 'a')
    expect(after.blocks[0].visible).toBe(false)
    expect(after.blocks[1]).toBe(before.blocks[1])
    expect(before.blocks[0].visible).toBe(true)
  })

  it('sets props and style immutably', () => {
    const before = doc('a')
    const withProp = setBlockProp(before, 'a', 'heading', 'جديد')
    expect(withProp.blocks[0].props).toEqual({ heading: 'جديد' })
    expect(before.blocks[0].props).toEqual({})
    expect(setBlockStyle(withProp, 'a', 'bg_color', '#000').blocks[0].style).toEqual({ bg_color: '#000' })
    expect(setBlockProp(before, 'missing', 'x', 1)).toBe(before)
  })

  it('sets and clears the custom label', () => {
    const named = setBlockLabel(doc('a'), 'a', 'قسم الترحيب')
    expect(named.blocks[0].label).toBe('قسم الترحيب')
    expect('label' in setBlockLabel(named, 'a', '').blocks[0]).toBe(false)
  })

  it('sets theme and settings values', () => {
    const d = doc('a')
    expect(setTheme(d, 'accent', '#b8914f').theme).toEqual({ bg: '#fff', accent: '#b8914f' })
    expect(setSetting(d, 'show_branding', false).settings).toEqual({ show_branding: false })
  })

  it('finds a block by id', () => {
    const d = doc('a', 'b')
    expect(findBlock(d, 'b')?.id).toBe('b')
    expect(findBlock(d, 'zzz')).toBeNull()
    expect(findBlock(d, null)).toBeNull()
  })
})
