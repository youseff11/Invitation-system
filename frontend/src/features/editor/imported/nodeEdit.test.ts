import { describe, expect, it } from 'vitest'

import { cssNumber, fontKey, lineRatio, toHex } from './css'
import { parse } from './dom'
import { applyNodeEdit, readNode, styleTarget, textUnitIn } from './nodeEdit'
import { editOf, nodeInfo } from './ops'

const HTML =
  '<div data-move="el-1" class="card lb-el-picked tn-box">' +
  '<h1 data-move="el-2" style="color: rgb(200, 30, 30)">ليلى <span>&amp;</span><br>كريم</h1>' +
  '<img data-move="el-3" src="/m/a.png" srcset="/m/a.png 1x, /m/a@2x.png 2x">' +
  '<video data-move="el-4" src="/m/v.mp4"></video>' +
  '<div data-move="el-5" class="shape"></div>' +
  '</div>'

const dom = () => parse(HTML)
const node = (root: Element, slot: string) => root.querySelector(`[data-move="${slot}"]`) as HTMLElement

describe('style target', () => {
  it('is the image, then the video, then the text unit, then the element itself', () => {
    const root = dom()
    expect(styleTarget(node(root, 'el-3')).tagName).toBe('IMG')
    expect(styleTarget(node(root, 'el-4')).tagName).toBe('VIDEO')
    expect(styleTarget(node(root, 'el-2')).tagName).toBe('H1')
    expect(styleTarget(node(root, 'el-5'))).toBe(node(root, 'el-5'))
    // حاوية فيها صورة ونص: الصورة بتكسب (زي القديم)
    expect(styleTarget(node(root, 'el-1')).tagName).toBe('IMG')
  })

  it('finds the first text unit inside a container, or the element itself when it is one', () => {
    const root = parse('<div data-move="el-1"><div><p>أول</p><p>تاني</p></div></div>')
    expect(textUnitIn(node(root, 'el-1'))?.textContent).toBe('أول')
    expect(textUnitIn(node(parse(HTML), 'el-5'))).toBeNull()
  })
})

describe('applyNodeEdit', () => {
  it('sets and removes inline style on the style target; empty removes (and drops an empty style attribute)', () => {
    const root = dom()
    expect(applyNodeEdit(root, 'el-2', { kind: 'style', prop: 'font-size', value: '30px' })).toBe(true)
    expect(node(root, 'el-2').style.fontSize).toBe('30px')
    expect(node(root, 'el-2').style.color).not.toBe('') // اللي كان موجود فضل
    applyNodeEdit(root, 'el-2', { kind: 'style', prop: 'font-size', value: '' })
    applyNodeEdit(root, 'el-2', { kind: 'style', prop: 'color', value: '' })
    expect(node(root, 'el-2').hasAttribute('style')).toBe(false)
  })

  it('styles the image inside a container, not the container', () => {
    const root = dom()
    applyNodeEdit(root, 'el-1', { kind: 'style', prop: 'border-radius', value: '12px' })
    expect(node(root, 'el-3').style.borderRadius).toBe('12px')
    expect(node(root, 'el-1').style.borderRadius).toBe('')
  })

  it('self edits the selected element itself (hide)', () => {
    const root = dom()
    applyNodeEdit(root, 'el-1', { kind: 'self', prop: 'display', value: 'none' })
    expect(node(root, 'el-1').style.display).toBe('none')
    expect(node(root, 'el-3').style.display).toBe('')
    applyNodeEdit(root, 'el-1', { kind: 'self', prop: 'display', value: '' })
    expect(node(root, 'el-1').hasAttribute('style')).toBe(false)
  })

  it('replaces text as plain text (markup in the value stays text)', () => {
    const root = dom()
    applyNodeEdit(root, 'el-2', { kind: 'text', value: 'a <b>x</b>\nb' })
    expect(node(root, 'el-2').children).toHaveLength(0)
    expect(node(root, 'el-2').textContent).toBe('a <b>x</b>\nb')
  })

  it('swaps the image source and drops srcset (it beats src)', () => {
    const root = dom()
    applyNodeEdit(root, 'el-3', { kind: 'src', value: '/m/b.png' })
    expect(node(root, 'el-3').getAttribute('src')).toBe('/m/b.png')
    expect(node(root, 'el-3').hasAttribute('srcset')).toBe(false)
  })

  it('reports false when there is nothing to edit', () => {
    const root = dom()
    expect(applyNodeEdit(root, 'el-99', { kind: 'text', value: 'x' })).toBe(false)
    expect(applyNodeEdit(root, 'el-5', { kind: 'text', value: 'x' })).toBe(false) // مفيش نص
    expect(applyNodeEdit(root, 'el-2', { kind: 'src', value: '/x.png' })).toBe(false) // مفيش صورة
  })
})

describe('readNode', () => {
  it('reads a text unit: kind, plain text with line breaks, inline styles', () => {
    const info = readNode(dom(), 'el-2')!
    expect(info).toMatchObject({ tag: 'H1', kind: 'text', src: null, hidden: false })
    expect(info.text).toBe('ليلى &\nكريم')
    expect(info.styles['font-size']).toBe('')
    expect(info.styles.color).not.toBe('')
  })

  it('collapses the whitespace the html source uses for layout, keeps real line breaks', () => {
    const root = parse('<h1 data-move="el-1">\n   Mohamed\n   &amp;\n   <br>  Farah\n </h1>')
    expect(readNode(root, 'el-1')?.text).toBe('Mohamed &\nFarah')
  })

  it('reads an image and prefers it inside a container; ignores our own classes', () => {
    const info = readNode(dom(), 'el-1')!
    expect(info.kind).toBe('image')
    expect(info.src).toBe('/m/a.png')
    expect(info.className).toBe('card') // مش lb-el-picked
  })

  it('knows video, shapes, hidden, and missing elements', () => {
    const root = dom()
    expect(readNode(root, 'el-4')?.kind).toBe('video')
    expect(readNode(root, 'el-5')).toMatchObject({ kind: 'shape', text: null })
    applyNodeEdit(root, 'el-5', { kind: 'self', prop: 'display', value: 'none' })
    expect(readNode(root, 'el-5')?.hidden).toBe(true)
    expect(readNode(root, 'nope')).toBeNull()
  })
})

describe('editOf / nodeInfo (what the store uses)', () => {
  it('returns new html that reads back, keeps the element selected, and never mutates the input', () => {
    const edit = editOf(HTML, 'el-2', { kind: 'style', prop: 'font-size', value: '40px' })!
    expect(edit.select).toBe('el-2')
    expect(edit.dropped).toEqual([])
    expect(nodeInfo(edit.html, 'el-2')?.styles['font-size']).toBe('40px')
    expect(nodeInfo(HTML, 'el-2')?.styles['font-size']).toBe('')
  })

  it('is stable: applying the same edit to its own output changes nothing', () => {
    const once = editOf(HTML, 'el-2', { kind: 'style', prop: 'font-size', value: '40px' })!
    const twice = editOf(once.html, 'el-2', { kind: 'style', prop: 'font-size', value: '40px' })!
    expect(twice.html).toBe(once.html)
  })

  it('is null for a missing element', () => {
    expect(editOf(HTML, 'el-99', { kind: 'text', value: 'x' })).toBeNull()
  })
})

describe('css helpers', () => {
  it('toHex turns opaque rgb into hex and leaves everything else alone', () => {
    expect(toHex('rgb(17, 34, 51)')).toBe('#112233')
    expect(toHex('rgba(255, 0, 0, 1)')).toBe('#ff0000')
    expect(toHex('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)')
    expect(toHex('#abc')).toBe('#abc')
    expect(toHex('')).toBe('')
  })

  it('cssNumber / lineRatio / fontKey', () => {
    expect(cssNumber('24px')).toBe(24)
    expect(cssNumber('1.5')).toBe(1.5)
    expect(cssNumber('normal')).toBeNull()
    expect(cssNumber('')).toBeNull()
    expect(lineRatio(30, 20)).toBe(1.5)
    expect(lineRatio(30, 0)).toBe(1.88)
    expect(fontKey(`"Cairo",  'Tajawal', sans-serif`)).toBe('cairo, tajawal, sans-serif')
  })
})

describe('video, map and countdown (S4b)', () => {
  const MEDIA =
    '<div data-move="el-1"><video data-move="el-2" src="/m/old.mp4" data-src="/m/old.mp4"><source src="/m/old.mp4" srcset="/m/old.mp4 1x"></video></div>' +
    '<div class="tn-elem" data-field-width-value="300" data-field-width-res-320-value="280" data-move="el-3">' +
    '<iframe src="https://www.google.com/maps?q=1,2&output=embed"></iframe></div>' +
    '<div id="countdownContainer" data-move="el-4"><span class="cd-days" data-move="el-5">10</span></div>'

  it('swaps a video source everywhere it is written (video, data-src, <source>)', () => {
    const root = parse(MEDIA)
    expect(applyNodeEdit(root, 'el-1', { kind: 'video-src', value: '/m/new.mp4' })).toBe(true)
    const video = root.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/m/new.mp4')
    expect(video.getAttribute('preload')).toBe('auto')
    expect(video.hasAttribute('data-src')).toBe(false)
    expect(video.querySelector('source')?.getAttribute('src')).toBe('/m/new.mp4')
    expect(video.querySelector('source')?.hasAttribute('srcset')).toBe(false)
    expect(applyNodeEdit(root, 'el-1', { kind: 'video-src', value: '' })).toBe(false) // ما بنمسحش الفيديو
  })

  it('changes the map link, and sizes its Tilda box (data attributes, responsive ones, !important)', () => {
    const root = parse(MEDIA)
    expect(applyNodeEdit(root, 'el-3', { kind: 'map-src', value: 'https://www.google.com/maps?q=3,4&output=embed' })).toBe(true)
    expect(root.querySelector('iframe')?.getAttribute('src')).toContain('q=3,4')

    applyNodeEdit(root, 'el-3', { kind: 'map-size', prop: 'width', value: 420 })
    const box = root.querySelector('.tn-elem') as HTMLElement
    expect(box.getAttribute('data-field-width-value')).toBe('420')
    expect(box.getAttribute('data-lb-map-width')).toBe('420')
    expect(box.getAttribute('data-field-width-res-320-value')).toBe('420')
    expect(box.style.getPropertyValue('width')).toBe('420px')
    expect(box.style.getPropertyPriority('width')).toBe('important')
    expect((root.querySelector('iframe') as HTMLElement).style.getPropertyValue('width')).toBe('100%')
    // حد أدنى وأقصى
    applyNodeEdit(root, 'el-3', { kind: 'map-size', prop: 'height', value: 5000 })
    expect(box.getAttribute('data-lb-map-height')).toBe('900')
  })

  it('rejects map edits on something that is not a Google map', () => {
    const root = parse(MEDIA)
    expect(applyNodeEdit(root, 'el-4', { kind: 'map-src', value: 'https://www.google.com/maps?q=1,2&output=embed' })).toBe(false)
    expect(applyNodeEdit(root, 'el-2', { kind: 'map-size', prop: 'width', value: 300 })).toBe(false)
  })

  it('readNode knows the kinds, the map size (default 335) and countdown parts', () => {
    const root = parse(MEDIA)
    expect(readNode(root, 'el-2')).toMatchObject({ kind: 'video', videoSrc: '/m/old.mp4' })
    const map = readNode(root, 'el-3')!
    expect(map.kind).toBe('map')
    expect(map.map).toEqual({ src: 'https://www.google.com/maps?q=1,2&output=embed', width: 300, height: 335 })
    expect(readNode(root, 'el-5')?.countdown).toBe(true)
    expect(readNode(root, 'el-4')?.countdown).toBe(true)
    expect(readNode(root, 'el-1')?.countdown).toBe(false)
  })
})
