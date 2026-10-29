import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

import { AUTOSAVE_IDLE, startAutosave } from './autosave'
import { COALESCE_MS, HISTORY_MAX, resetEditor, useEditor } from './store'
import type { BlockSpec, Bootstrap, DocBlock } from './types'

vi.mock('./api', () => ({ postSave: vi.fn() }))
import { postSave } from './api'

const save = vi.mocked(postSave)

const block = (id: string, type = 'text'): DocBlock => ({ id, type, visible: true, locked: false, props: {}, style: {} })

const boot = (ids = ['a', 'b', 'c'], extra: Partial<Bootstrap> = {}): Bootstrap => ({
  mode: 'invitation',
  id: 7,
  title: 'ليلى وأحمد',
  document: { version: 1, theme: {}, settings: {}, blocks: ids.map((id) => block(id)) },
  fields: {
    title: '', eventType: '', nameOne: 'ليلى', nameTwo: 'أحمد', eventDate: '', venue: '',
    address: '', mapUrl: '', whatsapp: '', status: 'draft', expiresAt: '', password: '', slug: 'laila',
  },
  features: ['rsvp'],
  assets: [], fonts: [], intros: [], music: [], categories: [],
  meta: { slug: 'laila', status: 'draft', planName: '', templateName: '', publicUrl: '', clientFollowupUrl: '', backUrl: '' },
  ...extra,
})

const spec = (type: string, singleton = false): BlockSpec => ({
  type, label: type, icon: '', description: '', category: '', feature: '', singleton,
  props: [{ key: 'heading', label: '', type: 'text', default: 'x', group: '' }], style: [],
})

const ids = () => useEditor.getState().doc.blocks.map((b) => b.id)
const s = () => useEditor.getState()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  resetEditor()
  save.mockReset()
  s().load(boot())
})
afterEach(() => vi.useRealTimers())

describe('load', () => {
  it('starts clean and saved', () => {
    expect(s()).toMatchObject({ loaded: true, mode: 'invitation', id: 7, saveStatus: 'saved', rev: 0, selected: null })
    expect(s().history).toEqual([])
  })
})

describe('structure edits', () => {
  it('adds after the selection and selects the new block', () => {
    s().select('a', 'preview')
    expect(s().addBlock(spec('quote'))).toBe(true)
    expect(ids().slice(0, 1)).toEqual(['a'])
    expect(ids()[1]).toMatch(/^quote-/)
    expect(s().selected).toBe(ids()[1])
    expect(s().tab).toBe('inspector')
    expect(s().saveStatus).toBe('dirty')
  })

  it('refuses a second singleton', () => {
    expect(s().addBlock(spec('hero', true))).toBe(true)
    expect(s().addBlock(spec('hero', true))).toBe(false)
    expect(ids().filter((id) => id.startsWith('hero-'))).toHaveLength(1)
  })

  it('duplicates, removes (clearing the selection) and moves', () => {
    s().select('b')
    expect(s().duplicate('b')).toBe(true)
    expect(ids()).toHaveLength(4)
    expect(s().selected).not.toBe('b')

    const copy = s().selected!
    s().remove(copy)
    expect(s().selected).toBeNull()
    expect(ids()).toEqual(['a', 'b', 'c'])

    s().move('a', 'c')
    expect(ids()).toEqual(['b', 'c', 'a'])
    s().toggleVisible('b')
    expect(s().doc.blocks[0].visible).toBe(false)
    expect(s().duplicate('nope')).toBe(false)
  })
})

describe('select', () => {
  it('opens the inspector for list clicks only', () => {
    s().select('a', 'preview')
    expect(s().tab).toBe('blocks')
    expect(s().selectSource).toBe('preview')
    s().select('b', 'list')
    expect(s().tab).toBe('inspector')
    s().select(null)
    expect(s().selectSource).toBeNull()
  })
})

describe('history', () => {
  it('undoes and redoes structure edits and keeps the selection valid', () => {
    s().select('c')
    s().remove('c')
    expect(s().selected).toBeNull()
    s().undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
    s().redo()
    expect(ids()).toEqual(['a', 'b'])
    s().undo()
    s().undo() // لا حاجة قبلها
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(s().history).toHaveLength(0)
  })

  it('a new edit clears the redo stack', () => {
    s().remove('a')
    s().undo()
    expect(s().future).toHaveLength(1)
    s().remove('b')
    expect(s().future).toHaveLength(0)
  })

  it('coalesces a burst of edits to one field into one undo step', () => {
    for (const ch of ['س', 'سل', 'سلا', 'سلام']) {
      s().setProp('a', 'heading', ch)
      vi.advanceTimersByTime(100)
    }
    expect(s().history).toHaveLength(1)
    s().undo()
    expect(s().doc.blocks[0].props.heading).toBeUndefined()
  })

  it('starts a new step after the pause or on another field', () => {
    s().setProp('a', 'heading', '1')
    vi.advanceTimersByTime(COALESCE_MS + 1)
    s().setProp('a', 'heading', '2')
    s().setProp('a', 'body', '3')
    expect(s().history).toHaveLength(3)
  })

  it('caps the history', () => {
    for (let i = 0; i < HISTORY_MAX + 20; i++) {
      s().toggleVisible('a')
    }
    expect(s().history).toHaveLength(HISTORY_MAX)
  })

  it('ignores edits that change nothing', () => {
    s().move('a', 'a')
    s().remove('missing')
    expect(s().history).toHaveLength(0)
    expect(s().saveStatus).toBe('saved')
  })
})

describe('event fields', () => {
  it('marks dirty and clears the field error', () => {
    useEditor.setState({ fieldErrors: { slug: 'محجوز' } })
    s().setEventField('slug', 'new-slug')
    expect(s().fields?.slug).toBe('new-slug')
    expect(s().fieldErrors).toEqual({})
    expect(s().saveStatus).toBe('dirty')
  })

  it('is a no-op for template mode', () => {
    s().load(boot(['a'], { mode: 'template', fields: null }))
    s().setEventField('nameOne', 'x')
    expect(s().saveStatus).toBe('saved')
  })
})

describe('save', () => {
  const ok = { savedAt: '10:00:00', slug: 'laila', status: 'published', publicUrl: 'https://x/i/laila/', clientFollowupUrl: '' }

  it('sends the document and the event fields, then reads saved', async () => {
    save.mockResolvedValue(ok)
    s().remove('a')
    await expect(s().save()).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith('invitation', 7, s().doc, s().fields)
    expect(s()).toMatchObject({ saveStatus: 'saved', savedAt: '10:00:00' })
    expect(s().meta?.status).toBe('published')
  })

  it('stays dirty when something changed while saving', async () => {
    let finish!: (value: typeof ok) => void
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    s().remove('a')
    const pending = s().save()
    expect(s().saveStatus).toBe('saving')
    s().toggleVisible('b')
    expect(s().saveStatus).toBe('saving')
    finish(ok)
    await pending
    expect(s().saveStatus).toBe('dirty')
  })

  it('does not start a second save while one is running', async () => {
    let finish!: (value: typeof ok) => void
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const first = s().save()
    await expect(s().save()).resolves.toBe(false)
    finish(ok)
    await first
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps validation errors per field and the server slug on success', async () => {
    save.mockRejectedValue(new ApiError(400, 'validation_error', 'راجع البيانات', { slug: 'الرابط مستخدم' }))
    await expect(s().save()).resolves.toBe(false)
    expect(s()).toMatchObject({ saveStatus: 'error', saveError: 'راجع البيانات', fieldErrors: { slug: 'الرابط مستخدم' } })

    save.mockResolvedValue({ ...ok, slug: 'cleaned-slug' })
    await s().save()
    expect(s().fields?.slug).toBe('cleaned-slug')
    expect(s().fieldErrors).toEqual({})
  })

  it('reports a network failure without an api message', async () => {
    save.mockRejectedValue(new TypeError('offline'))
    await expect(s().save()).resolves.toBe(false)
    expect(s()).toMatchObject({ saveStatus: 'error', saveError: '' })
  })
})

describe('autosave', () => {
  const ok = { savedAt: '10:00:00', slug: 'laila', status: 'draft', publicUrl: '', clientFollowupUrl: '' }
  let stop: () => void
  beforeEach(() => {
    stop = startAutosave()
  })
  afterEach(() => stop())

  it('saves once after the user goes quiet', async () => {
    save.mockResolvedValue(ok)
    s().remove('a')
    vi.advanceTimersByTime(AUTOSAVE_IDLE - 10)
    s().remove('b') // تعديل جديد يعيد العدّاد
    vi.advanceTimersByTime(AUTOSAVE_IDLE - 10)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    expect(save).toHaveBeenCalledTimes(1)
    expect(s().saveStatus).toBe('saved')
  })

  it('stops after a failure until a manual save succeeds', async () => {
    save.mockRejectedValue(new TypeError('offline'))
    s().remove('a')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE + 10)
    expect(save).toHaveBeenCalledTimes(1)
    s().remove('b')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE * 2)
    expect(save).toHaveBeenCalledTimes(1)

    save.mockResolvedValue(ok)
    await s().save()
    s().toggleVisible('c')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE + 10)
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('does nothing when nothing changed', async () => {
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE * 3)
    expect(save).not.toHaveBeenCalled()
  })
})
