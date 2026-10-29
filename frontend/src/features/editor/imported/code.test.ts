import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { introLayout, layoutOf, nudgeLayout, resetLayout, setLayout } from '../doc'
import { resetEditor, useEditor } from '../store'
import type { Bootstrap, DocBlock, EditorDocument } from '../types'
import { parse } from './dom'
import { layersOf, pasteOf } from './ops'
import { INTRO_ID, numberByPath, rebuildCode, slotKind, sourceOf, splitCode, writeSource } from './source'
import { codeMovables, isCodeTextUnit, isTextual } from './units'

const STYLE = '<style>.names{color:red}</style>'
const SCRIPT = '<script>root.dataset.ok = "1"</script>'
const REGION = '<div class="names"><span data-move="ce-1">ليلى</span><span data-move="ce-2">كريم</span></div><img data-move="ce-3" src="/a.png">'
const CODE = `${SCRIPT}\n${REGION}\n${STYLE}`

describe('code field split / rebuild', () => {
  it('separates style, script and the html region', () => {
    const parts = splitCode(CODE)
    expect(parts.styles).toEqual([STYLE])
    expect(parts.scripts).toEqual([SCRIPT])
    expect(parts.region.trim()).toBe(REGION)
  })

  it('rebuilds as style, html, script and keeps style/script text untouched', () => {
    expect(rebuildCode(CODE, '<p>x</p>')).toBe(`${STYLE}\n<p>x</p>\n${SCRIPT}`)
  })

  it('drops empty parts and handles an unterminated style/script like the browser would', () => {
    expect(rebuildCode('<p>a</p>', '<p>b</p>')).toBe('<p>b</p>')
    expect(rebuildCode('<style>a{}', '')).toBe('<style>a{}')
    expect(splitCode('<script>var a = 1').scripts).toEqual(['<script>var a = 1'])
  })

  it('is stable: rebuilding the rebuilt text changes nothing', () => {
    const once = rebuildCode(CODE, splitCode(CODE).region)
    expect(rebuildCode(once, splitCode(once).region)).toBe(once)
  })

  it('slotKind: ce-N and the box are code; el-N and everything else are html', () => {
    expect(['ce-1', 'code', 'ce-12'].map(slotKind)).toEqual(['code', 'code', 'code'])
    expect(['el-1', 'kicker', 'ce-', 'ce-x'].map(slotKind)).toEqual(['html', 'html', 'html', 'html'])
  })
})

describe('code text units (wider than imported ones)', () => {
  const box = (html: string) => {
    const root = parse(html, 'code')
    return { root, q: (sel: string) => root.querySelector(sel)! }
  }

  it('a div that is all text is a unit — the designer writes names in divs as in h1s', () => {
    const { root, q } = box('<div class="a">ليلى</div><div class="b"><span>ليلى</span><span>كريم</span></div><h1 class="c">ليلى<span>&amp;</span>كريم</h1>')
    expect(isCodeTextUnit(q('.a'), root)).toBe(true)
    // الأب اللي كلامه كله في أبنائه حاوية، وكل ابن وحدة
    expect(isCodeTextUnit(q('.b'), root)).toBe(false)
    expect(isCodeTextUnit(q('.b span'), root)).toBe(true)
    // لو الأب نفسه فيه كلام مباشر يبقى هو الوحدة
    expect(isCodeTextUnit(q('.c'), root)).toBe(true)
  })

  it('anything with media, controls or a non-inline child is not a unit; the box itself never is', () => {
    const { root, q } = box('<p class="a">x<img src="a.png"></p><p class="b">x<button>y</button></p><div class="c"><p>nested</p></div><p class="d"> </p>')
    for (const sel of ['.a', '.b', '.c', '.d']) expect(isCodeTextUnit(q(sel), root)).toBe(false)
    expect(isCodeTextUnit(root, root)).toBe(false)
  })

  it('isTextual switches rules by the root it lives in', () => {
    const code = parse('<div class="n">ليلى</div>', 'code')
    const imported = parse('<div class="n">ليلى</div>', 'html')
    expect(isTextual(code.querySelector('.n')!)).toBe(true) // div نصي في كود
    expect(isTextual(imported.querySelector('.n')!)).toBe(false) // DIV مش وسم نصي في القسم المستورد
  })

  describe('codeMovables', () => {
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return (this.classList.contains('tiny') ? { width: 2, height: 2 } : { width: 80, height: 30 }) as DOMRect
      })
    })
    afterEach(() => vi.restoreAllMocks())

    it('takes the outer layers, the text units and the media — not the in-between wrappers or tiny things', () => {
      const root = parse(
        '<section class="shape"><div class="wrap"><p class="t">ليلى</p><img class="i" src="a.png"><i class="tiny"></i></div></section>',
        'code',
      )
      const names = codeMovables(root).map((n) => n.className)
      expect(names).toEqual(['shape', 't', 'i'])
    })
  })
})

describe('numbering by path into the original text', () => {
  const REGION2 = '<div><p>ليلى</p><p>كريم</p></div><img src="a.png">'

  it('writes data-move on the element at the path (tag must match) and nothing else', () => {
    const out = numberByPath(REGION2, [
      { path: [0, 1], slot: 'ce-2', tag: 'P' },
      { path: [1], slot: 'ce-3', tag: 'IMG' },
    ])!
    const root = parse(out, 'code')
    expect(root.querySelector('p:nth-child(2)')?.getAttribute('data-move')).toBe('ce-2')
    expect(root.querySelector('img')?.getAttribute('data-move')).toBe('ce-3')
    expect(root.querySelector('p:nth-child(1)')?.hasAttribute('data-move')).toBe(false)
  })

  it('skips a lost path, a different tag, an already numbered node and a duplicate number; null when nothing changed', () => {
    expect(numberByPath(REGION2, [{ path: [0, 5], slot: 'ce-1', tag: 'P' }])).toBeNull()
    expect(numberByPath(REGION2, [{ path: [0, 0], slot: 'ce-1', tag: 'DIV' }])).toBeNull()
    expect(numberByPath(REGION2, [{ path: [], slot: 'ce-1', tag: 'DIV' }])).toBeNull() // الصندوق نفسه
    expect(numberByPath('<p data-move="ce-1">a</p><p>b</p>', [{ path: [0], slot: 'ce-9', tag: 'P' }])).toBeNull()
    expect(numberByPath('<p data-move="ce-1">a</p><p>b</p>', [{ path: [1], slot: 'ce-1', tag: 'P' }])).toBeNull()
  })

  it('is idempotent: numbering the result again with the same items is a no-op', () => {
    const items = [{ path: [0, 1], slot: 'ce-2', tag: 'P' }]
    const once = numberByPath(REGION2, items)!
    expect(numberByPath(once, items)).toBeNull()
  })
})

describe('ops on a code region', () => {
  it('paste / add use ce-N numbers (el-N would collide with the imported html in the same block)', () => {
    const edit = pasteOf(REGION, 'ce-1', '<span>جديد</span>')!
    expect(edit.select).toBe('ce-4')
    expect(parse(edit.html, 'code').querySelector('[data-move="ce-4"]')?.textContent).toBe('جديد')
  })

  it('layers of a code box: text units and the image, container skipped', () => {
    expect(layersOf(REGION, 'code').map((l) => [l.slot, l.kind])).toEqual([
      ['ce-1', 'text'],
      ['ce-2', 'text'],
      ['ce-3', 'image'],
    ])
  })
})

describe('intro layout table (settings.intro_code_layout)', () => {
  const doc = (settings: Record<string, unknown> = {}): EditorDocument => ({ version: 1, theme: {}, settings, blocks: [] })

  it('reads JSON, tolerates garbage', () => {
    expect(introLayout(doc({ intro_code_layout: '{"ce-1":{"dx":4,"dy":2}}' }))).toEqual({ 'ce-1': { dx: 4, dy: 2 } })
    expect(introLayout(doc({ intro_code_layout: 'nope' }))).toEqual({})
    expect(introLayout(doc({ intro_code_layout: '[1]' }))).toEqual({})
    expect(introLayout(doc())).toEqual({})
  })

  it('set / nudge / reset write the JSON string and empty it when nothing is left', () => {
    let d = setLayout(doc(), INTRO_ID, 'ce-1', 4, 2)
    expect(d.settings.intro_code_layout).toBe('{"ce-1":{"dx":4,"dy":2}}')
    d = nudgeLayout(d, INTRO_ID, 'ce-1', 1, -2)
    expect(layoutOf(d, INTRO_ID)).toEqual({ 'ce-1': { dx: 5, dy: 0 } })
    d = setLayout(d, INTRO_ID, 'ce-1', 0, 0)
    expect(d.settings.intro_code_layout).toBe('')
    d = setLayout(d, INTRO_ID, 'ce-2', 1, 1)
    expect(resetLayout(d, INTRO_ID).settings.intro_code_layout).toBe('')
  })
})

describe('sources in a document', () => {
  const block = (extra: Partial<DocBlock> = {}): DocBlock => ({
    id: 'b', type: 'hero', visible: true, locked: false, props: { code: CODE }, style: {}, ...extra,
  })
  const doc = (blocks: DocBlock[], settings: Record<string, unknown> = {}): EditorDocument => ({ version: 1, theme: {}, settings, blocks })

  it('finds the html region of a block code, props.html of an imported block, and the intro code', () => {
    expect(sourceOf(doc([block()]), 'b', 'ce-1')?.html.trim()).toBe(REGION)
    expect(sourceOf(doc([block({ props: { html: '<p>x</p>' } })]), 'b', 'el-1')).toMatchObject({ kind: 'html', html: '<p>x</p>' })
    expect(sourceOf(doc([], { intro_code: CODE }), INTRO_ID, 'ce-2')?.kind).toBe('code')
    expect(sourceOf(doc([block()]), 'b', 'el-1')).toBeNull() // مفيش props.html
    expect(sourceOf(doc([block()]), 'nope', 'ce-1')).toBeNull()
    expect(sourceOf(doc([], {}), INTRO_ID, 'ce-1')).toBeNull()
  })

  it('writes back keeping style and script, drops layout of removed slots, and for the intro prunes its table', () => {
    const d = doc([block({ layout: { 'ce-1': { dx: 1, dy: 1 }, 'ce-2': { dx: 2, dy: 2 } } })], {
      intro_code: CODE,
      intro_code_layout: '{"ce-1":{"dx":1,"dy":1},"ce-2":{"dx":2,"dy":2}}',
    })
    const src = sourceOf(d, 'b', 'ce-1')!
    const next = writeSource(d, 'b', src, '<p>x</p>', ['ce-1'])
    expect(next.blocks[0].props.code).toBe(`${STYLE}\n<p>x</p>\n${SCRIPT}`)
    expect(next.blocks[0].layout).toEqual({ 'ce-2': { dx: 2, dy: 2 } })

    const intro = sourceOf(d, INTRO_ID, 'ce-1')!
    const nextIntro = writeSource(d, INTRO_ID, intro, '<p>y</p>', ['ce-1'])
    expect(nextIntro.settings.intro_code).toBe(`${STYLE}\n<p>y</p>\n${SCRIPT}`)
    expect(nextIntro.settings.intro_code_layout).toBe('{"ce-2":{"dx":2,"dy":2}}')
  })
})

describe('store: elements of an advanced-code box', () => {
  const boot = (blocks: DocBlock[], settings: Record<string, unknown> = {}): Bootstrap => ({
    mode: 'template', id: 1, title: 't',
    document: { version: 1, theme: {}, settings, blocks },
    fields: null, features: [], assets: [], fonts: [], intros: [], music: [], categories: [],
    meta: { slug: 's', status: '', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  })
  const hero = (extra: Partial<DocBlock> = {}): DocBlock => ({
    id: 'a', type: 'hero', visible: true, locked: false, props: { code: CODE }, style: {},
    layout: { 'ce-2': { dx: 5, dy: 5 } }, ...extra,
  })
  const s = () => useEditor.getState()
  const code = () => String(s().doc.blocks[0].props.code)

  beforeEach(() => {
    resetEditor()
    s().load(boot([hero()]))
    s().select('a', 'preview')
  })

  it('delete removes the element from the code, keeps style and script, drops its position — one undo step', () => {
    s().selectElement('a', 'ce-2')
    expect(s().deleteElement()).toBe('ok')
    expect(code()).toContain(STYLE)
    expect(code()).toContain(SCRIPT)
    expect(code()).not.toContain('كريم')
    expect(s().doc.blocks[0].layout).toBeUndefined()
    expect(s().history).toHaveLength(1)
    s().undo()
    expect(code()).toBe(CODE) // التراجع بيرجّع النص الأصلي بالظبط (مش نسخة مرتّبة)
    expect(s().doc.blocks[0].layout).toEqual({ 'ce-2': { dx: 5, dy: 5 } })
  })

  it('paste / duplicate / edit work on the code and the new element gets a ce-N number', () => {
    s().selectElement('a', 'ce-1')
    expect(s().duplicateElement()).toBe('ok')
    expect(s().selEl).toEqual({ blockId: 'a', slot: 'ce-4' })
    expect(s().editElement({ kind: 'style', prop: 'color', value: 'red' })).toBe('ok')
    expect(code()).toMatch(/data-move="ce-4"[^>]*style="color: red;?"|style="color: red;?"[^>]*data-move="ce-4"/)
    expect(code()).toContain(SCRIPT)
  })

  it('numbering from the preview is silent (no undo step) and idempotent', () => {
    s().load(boot([hero({ props: { code: `${STYLE}<div><p>a</p><p>b</p></div>`, html: undefined } })]))
    const items = [{ path: [0, 1], slot: 'ce-1', tag: 'P' }]
    s().applyCodeNumbers('a', items)
    expect(code()).toContain('<p data-move="ce-1">b</p>')
    expect(code().startsWith(STYLE)).toBe(true)
    expect(s().history).toHaveLength(0)
    expect(s().saveStatus).toBe('dirty')
    const rev = s().rev
    s().applyCodeNumbers('a', items)
    expect(s().rev).toBe(rev) // مفيش تغيير = مفيش رسمة جديدة (مفيش لفة)
  })

  it('typing in the preview arrives as an inner-html edit by number: coalesced, refused when translated', () => {
    s().applyNodeEdits('a', [{ slot: 'ce-1', edit: { kind: 'inner', html: 'م' } }])
    s().applyNodeEdits('a', [{ slot: 'ce-1', edit: { kind: 'inner', html: 'مريم' } }])
    expect(code()).toContain('<span data-move="ce-1">مريم</span>')
    expect(s().history).toHaveLength(1)
    s().setRenderedLang('en')
    s().applyNodeEdits('a', [{ slot: 'ce-1', edit: { kind: 'inner', html: 'x' } }])
    expect(code()).toContain('مريم')
  })

  it('swapping two images from the preview is one step that exchanges src and srcset', () => {
    s().load(boot([hero({ props: { code: '<img data-move="ce-1" src="/a.png" srcset="/a2.png 2x"><img data-move="ce-2" src="/b.png">' } })]))
    s().applyNodeEdits('a', [
      { slot: 'ce-1', edit: { kind: 'attrs', values: { src: '/b.png', srcset: null } } },
      { slot: 'ce-2', edit: { kind: 'attrs', values: { src: '/a.png', srcset: '/a2.png 2x' } } },
    ])
    const root = parse(code(), 'code')
    expect(root.querySelector('[data-move="ce-1"]')?.getAttribute('src')).toBe('/b.png')
    expect(root.querySelector('[data-move="ce-1"]')?.hasAttribute('srcset')).toBe(false)
    expect(root.querySelector('[data-move="ce-2"]')?.getAttribute('srcset')).toBe('/a2.png 2x')
    expect(s().history).toHaveLength(1)
  })

  it('a locked section refuses', () => {
    s().load(boot([hero({ locked: true })]))
    s().selectElement('a', 'ce-1')
    expect(s().deleteElement()).toBe('locked')
    s().applyNodeEdits('a', [{ slot: 'ce-1', edit: { kind: 'inner', html: 'x' } }])
    expect(code()).toBe(CODE)
  })

  it('the intro code is a pseudo block: select, edit, delete prune settings.intro_code and its layout table', () => {
    s().load(boot([], { intro_code: CODE, intro_code_layout: '{"ce-2":{"dx":3,"dy":3}}' }))
    s().selectElement(INTRO_ID, 'ce-2')
    expect(s().selected).toBe(INTRO_ID)
    expect(s().editElement({ kind: 'inner', html: 'كريم 2' })).toBe('ok')
    expect(String(s().doc.settings.intro_code)).toContain('كريم 2')
    expect(s().deleteElement()).toBe('ok')
    expect(String(s().doc.settings.intro_code)).not.toContain('data-move="ce-2"')
    expect(s().doc.settings.intro_code_layout).toBe('')
    expect(s().selected).toBe(INTRO_ID) // التحديد على الافتتاحية بيفضل بعد أي commit
    s().undo()
    expect(s().selEl).toBeNull() // والعنصر اللي اتحذف رجع، فالتحديد بيتصفّر لأنه ماكانش موجود وقتها
  })
})
