import { beforeEach, describe, expect, it } from 'vitest'

import { clearTranslation, nudgeLayout, pruneTranslations, resetLayout, setLayout, setTranslation, setTranslationStyle } from './doc'
import { resetEditor, useEditor } from './store'
import type { DocBlock, EditorDocument } from './types'

const block = (id: string, extra: Partial<DocBlock> = {}): DocBlock => ({
  id, type: 'hero', visible: true, locked: false, props: {}, style: {}, ...extra,
})
const doc = (...blocks: DocBlock[]): EditorDocument => ({ version: 1, theme: {}, settings: {}, blocks })

describe('layout ops', () => {
  it('stores an offset, rounds it, and drops the slot (then the whole layout) at zero', () => {
    const a = setLayout(doc(block('a')), 'a', 'kicker', 3.456, -2)
    expect(a.blocks[0].layout).toEqual({ kicker: { dx: 3.46, dy: -2 } })
    const b = setLayout(a, 'a', 'name_one', 1, 1)
    expect(Object.keys(b.blocks[0].layout!)).toEqual(['kicker', 'name_one'])
    const c = setLayout(setLayout(b, 'a', 'kicker', 0, 0), 'a', 'name_one', 0, 0)
    expect('layout' in c.blocks[0]).toBe(false)
    expect(setLayout(a, 'zzz', 'kicker', 1, 1)).toBe(a)
  })

  it('nudges from the current offset and resets everything', () => {
    let d = nudgeLayout(doc(block('a')), 'a', 'kicker', 0.5, 0)
    d = nudgeLayout(d, 'a', 'kicker', 0.5, -0.5)
    expect(d.blocks[0].layout!.kicker).toEqual({ dx: 1, dy: -0.5 })
    expect('layout' in resetLayout(d, 'a').blocks[0]).toBe(false)
    const untouched = doc(block('a'))
    expect(resetLayout(untouched, 'a')).toBe(untouched)
  })

  it('never mutates the previous document', () => {
    const before = doc(block('a', { layout: { kicker: { dx: 1, dy: 1 } } }))
    setLayout(before, 'a', 'kicker', 5, 5)
    expect(before.blocks[0].layout).toEqual({ kicker: { dx: 1, dy: 1 } })
  })
})

describe('translation ops', () => {
  it('writes trimmed text per language and removes empties', () => {
    let d = setTranslation(doc(), 'en', 'hero-1.kicker', '  Wedding  ')
    expect(d.i18n).toEqual({ en: { 'hero-1.kicker': 'Wedding' } })
    d = setTranslation(d, 'en', 'hero-1.subtitle', 'Hello')
    d = setTranslation(d, 'en', 'hero-1.kicker', '   ')
    expect(d.i18n).toEqual({ en: { 'hero-1.subtitle': 'Hello' } })
  })

  it('keeps font and size per text, and treats blank / zero as "same as the original"', () => {
    let d = setTranslationStyle(doc(), 'en', 'k', 'font', "'Cormorant', serif")
    d = setTranslationStyle(d, 'en', 'k', 'size', 24)
    expect(d.i18n_style).toEqual({ en: { k: { font: "'Cormorant', serif", size: 24 } } })
    d = setTranslationStyle(d, 'en', 'k', 'size', 0)
    expect(d.i18n_style?.en.k).toEqual({ font: "'Cormorant', serif" })
    d = setTranslationStyle(d, 'en', 'k', 'font', '')
    expect(d.i18n_style?.en).toEqual({})
  })

  it('clears a language and prunes dead keys only', () => {
    let d = setTranslation(doc(), 'en', 'a', 'A')
    d = setTranslation(d, 'en', 'b', 'B')
    d = setTranslationStyle(d, 'en', 'b', 'size', 20)
    d = setTranslation(d, 'ar', 'a', 'ألف')
    const pruned = pruneTranslations(d, 'en', new Set(['a']))
    expect(pruned.i18n).toEqual({ en: { a: 'A' }, ar: { a: 'ألف' } })
    expect(pruned.i18n_style?.en).toEqual({})
    expect(pruneTranslations(pruned, 'en', new Set(['a']))).toBe(pruned)
    expect(clearTranslation(d, 'en').i18n).toEqual({ en: {}, ar: { a: 'ألف' } })
  })
})

describe('store: layout, translation and live text', () => {
  beforeEach(() => {
    resetEditor()
    useEditor.setState({ loaded: true, doc: doc(block('a'), block('b', { locked: true })) })
  })

  it('moves an element in one undo step and ignores locked sections', () => {
    useEditor.getState().setLayout('a', 'kicker', 2, 3)
    expect(useEditor.getState().doc.blocks[0].layout).toEqual({ kicker: { dx: 2, dy: 3 } })
    useEditor.getState().undo()
    expect('layout' in useEditor.getState().doc.blocks[0]).toBe(false)

    useEditor.getState().setLayout('b', 'kicker', 2, 3)
    useEditor.getState().nudgeLayout('b', 'kicker', 1, 1)
    expect('layout' in useEditor.getState().doc.blocks[1]).toBe(false)
  })

  it('writes the translation into the language opposite the base language', () => {
    useEditor.getState().setTranslation('a.kicker', 'Wedding')
    expect(useEditor.getState().doc.i18n).toEqual({ en: { 'a.kicker': 'Wedding' } })
    useEditor.setState({ doc: { ...useEditor.getState().doc, theme: { base_lang: 'en' } } })
    useEditor.getState().setTranslation('a.kicker', 'زفاف')
    expect(useEditor.getState().doc.i18n?.ar).toEqual({ 'a.kicker': 'زفاف' })
  })

  it('prunes dead translation keys silently (no undo step) and marks the document dirty', () => {
    useEditor.getState().setTranslation('gone.key', 'x')
    useEditor.getState().setTranslation('live.key', 'y')
    const history = useEditor.getState().history.length
    useEditor.getState().pruneTranslations(new Set(['live.key']))
    expect(useEditor.getState().doc.i18n?.en).toEqual({ 'live.key': 'y' })
    expect(useEditor.getState().history).toHaveLength(history)
    const rev = useEditor.getState().rev
    useEditor.getState().pruneTranslations(new Set(['live.key']))
    expect(useEditor.getState().rev).toBe(rev)
  })

  it('publishes each text edit for the live preview patch', () => {
    useEditor.getState().setProp('a', 'kicker', 'أ')
    useEditor.getState().setProp('a', 'kicker', 'أب')
    expect(useEditor.getState().lastText).toEqual({ seq: 2, id: 'a', key: 'kicker', value: 'أب' })
    useEditor.getState().setProp('a', 'size', 12)
    expect(useEditor.getState().lastText?.seq).toBe(2)
  })
})
