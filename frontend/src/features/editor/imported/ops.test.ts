import { describe, expect, it } from 'vitest'

import { addOf, copyOf, deleteOf, duplicateOf, hasSlot, inspect, layersOf, parentOf, pasteOf } from './ops'

/** قسم مستورد صناعي: حاوية فيها عنوان نصي وصورة وزر، والعنصر الأخير جوّه حاوية تانية. */
const SECTION =
  '<div data-move="el-1" class="card lb-el-picked">' +
  '<h1 data-move="el-2">ليلى <span>&amp;</span> كريم</h1>' +
  '<img data-move="el-3" src="/m/a.png">' +
  '<div data-move="el-4"><a data-move="el-5" href="#">سجّل</a></div>' +
  '</div>'

const root = (html: string) => {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder
}
const slots = (html: string) => Array.from(root(html).querySelectorAll('[data-move]')).map((n) => n.getAttribute('data-move'))

describe('copyOf', () => {
  it('returns a clean copy: no numbering, no editor marks, children kept', () => {
    const clip = copyOf(SECTION, 'el-1')!
    expect(clip).not.toContain('data-move')
    expect(clip).not.toContain('lb-el-picked')
    expect(clip).toContain('class="card"')
    expect(clip).toContain('<h1>')
  })

  it('is null for a slot that is not in the html', () => {
    expect(copyOf(SECTION, 'el-99')).toBeNull()
    expect(copyOf('', 'el-1')).toBeNull()
  })

  it('never mutates the source (it only parses a throw-away document)', () => {
    const before = SECTION
    copyOf(before, 'el-2')
    expect(before).toBe(SECTION)
  })
})

describe('pasteOf', () => {
  it('puts the copy after the element and gives it the first free number', () => {
    const clip = copyOf(SECTION, 'el-2')!
    const edit = pasteOf(SECTION, 'el-3', clip)!
    expect(edit.select).toBe('el-6')
    expect(edit.dropped).toEqual([])
    // ‎el-1…el-5‎ موجودين فالجديد el-6، وهو أخو الصورة بعدها مباشرة
    const out = root(edit.html)
    const fresh = out.querySelector('[data-move="el-6"]')!
    expect(fresh.tagName).toBe('H1')
    expect(fresh.previousElementSibling?.getAttribute('data-move')).toBe('el-3')
    // ومن غير ما نغيّر أرقام الباقيين
    expect(slots(edit.html)).toEqual(['el-1', 'el-2', 'el-3', 'el-6', 'el-4', 'el-5'])
  })

  it('reuses a hole in the numbering instead of growing forever', () => {
    const gappy = '<p data-move="el-1">a</p><p data-move="el-3">b</p>'
    const edit = pasteOf(gappy, 'el-1', '<p>c</p>')!
    expect(edit.select).toBe('el-2')
  })

  it('pastes inside a container when asked', () => {
    const edit = pasteOf(SECTION, 'el-4', copyOf(SECTION, 'el-3')!, true)!
    const container = root(edit.html).querySelector('[data-move="el-4"]')!
    expect(container.lastElementChild?.tagName).toBe('IMG')
    expect(container.lastElementChild?.getAttribute('data-move')).toBe(edit.select)
  })

  it('falls back to "after" for text units and for media that cannot hold children', () => {
    const intoText = pasteOf(SECTION, 'el-2', '<p>x</p>', true)!
    const h1 = root(intoText.html).querySelector('[data-move="el-2"]')!
    expect(h1.querySelector('p')).toBeNull()
    expect(h1.nextElementSibling?.tagName).toBe('P')

    const intoImg = pasteOf(SECTION, 'el-3', '<p>x</p>', true)!
    expect(root(intoImg.html).querySelector('[data-move="el-3"]')?.children.length).toBe(0)
  })

  it('refuses an empty clipboard and a missing target', () => {
    expect(pasteOf(SECTION, 'el-1', '')).toBeNull()
    expect(pasteOf(SECTION, 'el-99', '<p>x</p>')).toBeNull()
  })

  it('the pasted element carries no number from the source (the clip was cleaned)', () => {
    const edit = pasteOf(SECTION, 'el-5', copyOf(SECTION, 'el-4')!)!
    // الأب el-4 اتنسخ بابنه el-5: النسخة الجديدة لها رقم واحد بس، وابنها من غير رقم (الإطار هيرقّمه بعد الرسمة)
    const fresh = root(edit.html).querySelector(`[data-move="${edit.select}"]`)!
    expect(fresh.querySelector('[data-move]')).toBeNull()
    expect(slots(edit.html).filter((s) => s === 'el-5')).toHaveLength(1)
  })
})

describe('duplicateOf', () => {
  it('copies the element right after itself and selects the copy', () => {
    const edit = duplicateOf(SECTION, 'el-5')!
    const out = root(edit.html)
    const original = out.querySelector('[data-move="el-5"]')!
    expect(original.nextElementSibling?.getAttribute('data-move')).toBe(edit.select)
    expect(original.nextElementSibling?.textContent).toBe('سجّل')
  })

  it('is null for a missing element', () => {
    expect(duplicateOf(SECTION, 'nope')).toBeNull()
  })
})

describe('deleteOf', () => {
  it('removes the element and reports its own number and every number inside it', () => {
    const edit = deleteOf(SECTION, 'el-4')!
    expect(edit.dropped).toEqual(['el-4', 'el-5'])
    expect(edit.select).toBeNull()
    expect(slots(edit.html)).toEqual(['el-1', 'el-2', 'el-3'])
    expect(edit.html).not.toContain('سجّل')
  })

  it('a leaf drops just itself', () => {
    expect(deleteOf(SECTION, 'el-3')!.dropped).toEqual(['el-3'])
  })

  it('is null for a missing element', () => {
    expect(deleteOf(SECTION, 'el-99')).toBeNull()
  })
})

describe('addOf', () => {
  it('adds a paragraph inside a container and selects it', () => {
    const edit = addOf(SECTION, 'el-4', 'text', 'نص جديد')!
    const added = root(edit.html).querySelector(`[data-move="${edit.select}"]`)!
    expect(added.tagName).toBe('P')
    expect(added.textContent).toBe('نص جديد')
    expect(added.parentElement?.getAttribute('data-move')).toBe('el-4')
  })

  it('adds an image with the url, a safe style and no alt text', () => {
    const edit = addOf(SECTION, 'el-4', 'image', '/m/b.png')!
    const img = root(edit.html).querySelector(`[data-move="${edit.select}"]`)!
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('/m/b.png')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('style')).toContain('max-width:100%')
  })

  it('goes after a text unit or an image instead of inside it', () => {
    const afterText = addOf(SECTION, 'el-2', 'text', 'x')!
    expect(root(afterText.html).querySelector('[data-move="el-2"]')?.nextElementSibling?.getAttribute('data-move')).toBe(afterText.select)
    const afterImg = addOf(SECTION, 'el-3', 'image', '/m/c.png')!
    expect(root(afterImg.html).querySelector('[data-move="el-3"]')?.children).toHaveLength(0)
    expect(root(afterImg.html).querySelector('[data-move="el-3"]')?.nextElementSibling?.getAttribute('data-move')).toBe(afterImg.select)
  })

  it('treats the text as text, never as markup', () => {
    const edit = addOf(SECTION, 'el-4', 'text', '<img src=x onerror=alert(1)>')!
    expect(root(edit.html).querySelector('[onerror]')).toBeNull()
  })
})

describe('parentOf', () => {
  it('finds the nearest numbered ancestor, skipping unnumbered wrappers', () => {
    expect(parentOf(SECTION, 'el-5')).toBe('el-4')
    expect(parentOf(SECTION, 'el-4')).toBe('el-1')
    expect(parentOf('<div data-move="el-1"><section><p data-move="el-2">x</p></section></div>', 'el-2')).toBe('el-1')
  })

  it('is null for the top element and for a missing one', () => {
    expect(parentOf(SECTION, 'el-1')).toBeNull()
    expect(parentOf(SECTION, 'el-99')).toBeNull()
  })
})

describe('inspect / hasSlot', () => {
  it('knows text units and what can hold children', () => {
    expect(inspect(SECTION, 'el-2')).toEqual({ textual: true, canContain: false })
    expect(inspect(SECTION, 'el-3')).toEqual({ textual: false, canContain: false })
    expect(inspect(SECTION, 'el-4')).toEqual({ textual: false, canContain: true })
    expect(inspect(SECTION, 'el-99')).toBeNull()
  })

  it('hasSlot is the cheap existence check used after undo', () => {
    expect(hasSlot(SECTION, 'el-5')).toBe(true)
    expect(hasSlot(SECTION, 'el-6')).toBe(false)
  })
})

describe('layersOf', () => {
  it('lists the visible things: text, image, and the leaf container — not wrappers of those', () => {
    const layers = layersOf(SECTION)
    // el-1 (فيه نص وصورة) وel-4 (فيه نص) حاويات بتتخطّى؛ el-5 هو النص نفسه
    expect(layers.map((l) => [l.slot, l.kind])).toEqual([
      ['el-2', 'text'],
      ['el-3', 'image'],
      ['el-5', 'text'],
    ])
    expect(layers[0].text).toBe('ليلى & كريم')
    expect(layers[0].name).toBe('heading')
  })

  it('names a map, a video and a plain shape', () => {
    const html =
      '<div data-move="el-1"><iframe src="https://www.google.com/maps/embed?pb=1"></iframe></div>' +
      '<video data-move="el-2" src="/v.mp4"></video><div data-move="el-3" class="shape"></div>'
    expect(layersOf(html).map((l) => [l.slot, l.kind, l.name])).toEqual([
      ['el-2', 'video', 'element'],
      ['el-3', 'element', 'group'],
    ])
  })

  it('shortens long text and collapses whitespace', () => {
    const long = `<p data-move="el-1">${'كلمة  '.repeat(30)}</p>`
    const [layer] = layersOf(long)
    expect(layer.text.endsWith('…')).toBe(true)
    expect(layer.text.length).toBe(43)
    expect(layer.text).not.toContain('  ')
  })

  it('is empty for html with nothing numbered', () => {
    expect(layersOf('<p>x</p>')).toEqual([])
  })
})
