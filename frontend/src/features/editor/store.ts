import { create } from 'zustand'

import { ApiError } from '@/api/client'

import { postSave } from './api'
import * as ops from './doc'
import { findBlock, INTRO_ID } from './doc'
import type { NodeEdit } from './imported/nodeEdit'
import * as element from './imported/ops'
import { numberByPath, sourceOf, writeSource, type PathItem } from './imported/source'
import type {
  AssetRow,
  BlockSpec,
  Bootstrap,
  Device,
  EditorDocument,
  EditorMeta,
  EditorMode,
  EventFields,
  FieldOption,
  FontRow,
  IntroRow,
  MusicRow,
  TranslationStyle,
} from './types'

export const HISTORY_MAX = 60
/** تعديلات متتالية على نفس الحقل خلال المدة دي = خطوة تراجع واحدة */
export const COALESCE_MS = 900
/** إزاحة نسخة العنصر فوق القسم عن الأصل (٪ رأسياً) */
export const DUPLICATE_OFFSET = 4

export type Tab = 'blocks' | 'inspector' | 'theme' | 'data' | 'i18n' | 'settings'
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
/** مصدر التحديد: ضغطة في قايمة الأقسام بتمرّر المعاينة للقسم، وضغطة في المعاينة لأ. */
export type SelectSource = 'list' | 'preview' | null
/** نتيجة عملية على عنصر مستورد: ‎ok‎ اتنفّذت؛ والباقي سبب الرفض (الواجهة بتحوّله لتنبيه) */
export type ElementOutcome = 'ok' | 'missing' | 'empty' | 'top' | 'locked' | 'translated'

export interface Libraries {
  assets: AssetRow[]
  fonts: FontRow[]
  intros: IntroRow[]
  videos: IntroRow[]
  music: MusicRow[]
  categories: { value: string; label: string }[]
}

interface Data {
  loaded: boolean
  mode: EditorMode
  id: number
  title: string
  meta: EditorMeta | null
  features: string[]
  lib: Libraries
  /** خيارات حالة الدعوة لتبويب «البيانات» */
  statusChoices: FieldOption[]

  doc: EditorDocument
  fields: EventFields | null
  /** أخطاء التحقق من آخر حفظ (بالحقل) — بتتمسح لما الحقل يتعدّل */
  fieldErrors: Record<string, string>

  selected: string | null
  selectSource: SelectSource
  /** العنصر المحدَّد جوّه قسم مستورد (‎el-N‎) — بيتصفّر لما القسم يتغيّر */
  selEl: { blockId: string; slot: string } | null
  /** «عنصر فوق القسم» (نص/صورة/زرار) المحدَّد في المعاينة: القسم + ترتيبه في ‎text_overlays‎ */
  selOverlay: { blockId: string; index: number } | null
  /** القسم اللي إطار حدوده ومقبض ارتفاعه ظاهرين في المعاينة (واحد في المرة) */
  boundsBlock: string | null
  /** حافظة العناصر (نسخة نضيفة ‎outerHTML‎) — جوّه المحرر بس، مش حافظة النظام */
  clip: string | null
  /** آخر تعديل من لوحة العنصر: المعاينة بتطبّقه على DOM الحي لحظياً قبل رد السيرفر */
  lastEdit: { seq: number; id: string; slot: string; edit: NodeEdit } | null
  tab: Tab
  device: Device
  /** لغة المعاينة المطلوبة؛ فاضي = لغة الدعوة الأساسية */
  previewLang: string
  /** اللغة اللي المعاينة معروضة بيها فعلاً (من رد السيرفر) — فاضي قبل أول رد */
  renderedLang: string
  /** آخر نص اتكتب في خانة باللوحة: المعاينة بتحطه لحظياً قبل رد السيرفر */
  lastText: { seq: number; id: string; key: string; value: string } | null

  history: EditorDocument[]
  future: EditorDocument[]
  coalesce: { key: string; at: number } | null
  /** بيزيد مع أي تعديل في المستند أو بيانات المناسبة — المعاينة والحفظ بيراقبوه */
  rev: number
  /** قيمة ‎rev‎ اللي نتجت عن تراجع/إعادة: المعاينة مابتستناش وقفة الكتابة قبلها */
  instantRev: number
  /** بيزيد لما محتوى الدعوة نفسه يتغيّر (أقسام/إعدادات/بيانات) — مش لما الترجمة بس تتغيّر */
  contentRev: number

  saveStatus: SaveStatus
  savedAt: string
  saveError: string
}

interface Actions {
  load: (boot: Bootstrap) => void
  /** نقطة التعديل الوحيدة للمستند: بتحفظ لقطة للتراجع وتعلّم «غير محفوظ» */
  commit: (change: (doc: EditorDocument) => EditorDocument, opts?: { coalesce?: string }) => void
  select: (id: string | null, source?: SelectSource) => void
  selectElement: (blockId: string, slot: string | null) => void
  selectOverlay: (blockId: string, index: number | null) => void
  /** يمسح العنصر فوق القسم المحدَّد (خطوة تراجع واحدة) */
  removeOverlay: () => void
  /** ينسخ العنصر فوق القسم المحدَّد بنفس تنسيقه، مزحزَح شوية عشان يبان، ويحدّد النسخة (خطوة تراجع واحدة) */
  duplicateOverlay: () => void
  toggleBounds: (id: string) => void
  /** ‎props.html‎ لقسم مستورد من المعاينة: ‎silent‎ للترقيم التلقائي (من غير خطوة تراجع) */
  setHtml: (id: string, html: string, silent?: boolean) => void

  /**
   * عمليات هيكل العنصر المحدَّد جوّه القسم المستورد (S3) — كلها على ‎props.html‎ المحفوظ، وكل عملية خطوة
   * تراجع واحدة (النص + مواضع اللي اتشال). ‎slot‎ اختياري: من الطبقات بنشتغل على عنصر مش المحدَّد.
   */
  copyElement: () => ElementOutcome
  pasteElement: (inside?: boolean) => ElementOutcome
  duplicateElement: () => ElementOutcome
  deleteElement: (slot?: string) => ElementOutcome
  addElement: (kind: element.AddKind, value: string) => ElementOutcome
  /** تعديل نص/تنسيق/صورة العنصر المحدَّد من اللوحة. ‎coalesce‎: الشريط والكتابة المتتالية = خطوة تراجع واحدة */
  editElement: (edit: NodeEdit, coalesce?: string) => ElementOutcome
  selectParentElement: () => ElementOutcome
  /**
   * من المعاينة (صندوق «كود متقدّم» وكود الافتتاحية): أرقام ‎ce-N‎ اتحسبت على الـDOM الحي ← بتتكتب بالمسار في النص
   * الأصلي من غير خطوة تراجع (مش تعديل من المستخدم)؛ وكتابة/تبديل صورة جوّه الصندوق ← تعديلات بالرقم.
   */
  /** سحب «عنصر فوق القسم» (x/y/width) وعنصر افتتاحية (x/y) من المعاينة — خطوة تراجع واحدة لكل سحبة */
  setOverlay: (id: string, index: number, values: { x?: number; y?: number; width?: number }) => void
  setIntroItem: (key: string, x: number, y: number) => void
  applyCodeNumbers: (id: string, items: PathItem[]) => void
  applyNodeEdits: (id: string, edits: { slot: string; edit: NodeEdit }[]) => void
  setTab: (tab: Tab) => void
  setDevice: (device: Device) => void
  setPreviewLang: (lang: string) => void
  setRenderedLang: (lang: string) => void

  addBlock: (spec: BlockSpec) => boolean
  duplicate: (id: string) => boolean
  remove: (id: string) => void
  move: (fromId: string, toId: string) => void
  toggleVisible: (id: string) => void
  rename: (id: string, label: string) => void
  setProp: (id: string, key: string, value: unknown) => void
  /** عدّة خصائص مع بعض (خطوة تراجع واحدة) — ‎coalesce‎ للتغيير المتتالي (منتقي اللون) */
  setProps: (id: string, patch: Record<string, unknown>, coalesce?: string) => void
  setStyle: (id: string, key: string, value: unknown) => void
  setTheme: (key: string, value: unknown) => void
  setSetting: (key: string, value: unknown) => void
  setEventField: (key: keyof EventFields, value: string) => void

  /** مواضع العناصر (C4a): الإزاحة بوحدة cqw */
  setLayout: (id: string, slot: string, dx: number, dy: number) => void
  nudgeLayout: (id: string, slot: string, ddx: number, ddy: number) => void
  resetLayout: (id: string) => void

  /** الترجمة اليدوية (C4a): النسخة بتتكتب في لغة المستند التانية */
  setTranslation: (key: string, value: string) => void
  setTranslationStyle: (key: string, field: keyof TranslationStyle, value: string | number) => void
  clearTranslation: () => void
  /** تنضيف مفاتيح ميّتة: من غير خطوة تراجع (مش تعديل من المستخدم) */
  pruneTranslations: (live: ReadonlySet<string>) => void

  /** المكتبات (C3): بتتحدّث بعد الرفع/القص/الحذف من غير ما تحسب تعديل في المستند */
  setAssets: (assets: AssetRow[]) => void
  addAsset: (asset: AssetRow) => void
  removeAssets: (ids: number[]) => void
  addFont: (font: FontRow) => void

  undo: () => void
  redo: () => void
  save: () => Promise<boolean>
}

export type EditorState = Data & Actions

const emptyDoc = (): EditorDocument => ({ version: 1, theme: {}, settings: {}, blocks: [] })

const initial = (): Data => ({
  loaded: false,
  mode: 'invitation',
  id: 0,
  title: '',
  meta: null,
  features: [],
  lib: { assets: [], fonts: [], intros: [], videos: [], music: [], categories: [] },
  statusChoices: [],
  doc: emptyDoc(),
  fields: null,
  fieldErrors: {},
  selected: null,
  selectSource: null,
  selEl: null,
  selOverlay: null,
  boundsBlock: null,
  clip: null,
  lastEdit: null,
  tab: 'blocks',
  device: 'mobile',
  previewLang: '',
  renderedLang: '',
  lastText: null,
  history: [],
  future: [],
  coalesce: null,
  rev: 0,
  instantRev: -1,
  contentRev: 0,
  saveStatus: 'saved',
  savedAt: '',
  saveError: '',
})

/** لغة الدعوة الأساسية (‎theme.base_lang‎، الافتراضي عربي) واللغة التانية — زي ‎blocks.base_language/alt_language‎. */
export const baseLangOf = (doc: EditorDocument): 'ar' | 'en' =>
  String(doc.theme?.base_lang ?? 'ar').toLowerCase() === 'en' ? 'en' : 'ar'
export const altLangOf = (doc: EditorDocument): 'ar' | 'en' => (baseLangOf(doc) === 'ar' ? 'en' : 'ar')

/** ‎1‎ لو أقسام/إعدادات/ثيم المستند اتبدّلت (مراجع مختلفة) — تعديل الترجمة لوحده بيسيبهم زي ما هم. */
const contentChanged = (a: EditorDocument, b: EditorDocument) =>
  a.blocks !== b.blocks || a.settings !== b.settings || a.theme !== b.theme ? 1 : 0

/** المعاينة معروضة بنسخة مترجَمة؟ (نصها مش نص الدعوة — مانكتبش منها ولا نعدّل الهيكل) */
const translatedPreview = (state: Data) => state.renderedLang !== '' && state.renderedLang !== baseLangOf(state.doc)

/** العنصر المحدَّد لازم يفضل موجود في النص بعد تراجع/إعادة (عنصر اتلصق ثم اتراجع عنه مثلاً). */
const keepElement = (doc: EditorDocument, el: Data['selEl']): Data['selEl'] => {
  if (!el) return null
  const source = sourceOf(doc, el.blockId, el.slot)
  // مفيش مصدر (قسم عادي، أو الصندوق نفسه ‎code‎ لسه مالوش عناصر) = نسيب التحديد زي ما هو
  return !source || element.hasSlot(source.html, el.slot) || el.slot === 'code' ? el : null
}

/** العنصر فوق القسم المحدَّد لازم يفضل موجود بعد حذف/تراجع/إعادة. */
const keepOverlay = (doc: EditorDocument, sel: Data['selOverlay']): Data['selOverlay'] => {
  if (!sel) return null
  const list = findBlock(doc, sel.blockId)?.props.text_overlays
  return Array.isArray(list) && sel.index < list.length ? sel : null
}

/** التحديد لازم يفضل على قسم موجود (بعد حذف/تراجع) — والافتتاحية (‎__intro‎) مش قسم في القايمة بس بتتحدّد. */
const keepSelection = (doc: EditorDocument, selected: string | null) =>
  selected && (selected === INTRO_ID || doc.blocks.some((b) => b.id === selected)) ? selected : null

interface ElementTarget {
  blockId: string
  slot: string
  /** جزء الـHTML اللي بنعدّل فيه (‎props.html‎، أو جزء الـHTML من «الكود») */
  html: string
  source: NonNullable<ReturnType<typeof sourceOf>>
  locked: boolean
}

/** المصدر والعنصر اللي العملية هتشتغل عليهم: المحدَّد، أو ‎slot‎ من الطبقات جوّه القسم المحدَّد. */
function elementTarget(state: Data, slot?: string): ElementTarget | null {
  const blockId = state.selEl?.blockId ?? state.selected
  const at = slot ?? state.selEl?.slot
  if (!blockId || !at) return null
  const source = sourceOf(state.doc, blockId, at)
  if (!source) return null
  return { blockId, slot: at, html: source.html, source, locked: !!findBlock(state.doc, blockId)?.locked }
}

/** عملية هيكل واحدة = ‎commit‎ واحد (خطوة تراجع واحدة). بترفض في القسم المقفول وفي المعاينة المترجَمة. */
function runEdit(
  build: (target: ElementTarget) => element.Edit | null,
  slot?: string,
  coalesce?: string,
): ElementOutcome {
  const state = useEditor.getState()
  const target = elementTarget(state, slot)
  if (!target) return 'missing'
  if (target.locked) return 'locked'
  if (translatedPreview(state)) return 'translated'
  const edit = build(target)
  if (!edit) return 'missing'
  // تعديل ماغيّرش حاجة (نفس القيمة): مفيش خطوة تراجع ولا «غير محفوظ»
  if (edit.html === target.html && !edit.dropped.length) return 'ok'
  state.commit((d) => writeSource(d, target.blockId, target.source, edit.html, edit.dropped), coalesce ? { coalesce } : undefined)
  useEditor.setState({
    selected: target.blockId,
    selEl: edit.select ? { blockId: target.blockId, slot: edit.select } : null,
  })
  return 'ok'
}

export const useEditor = create<EditorState>()((set, get) => ({
  ...initial(),

  load: (boot) =>
    set({
      ...initial(),
      loaded: true,
      mode: boot.mode,
      id: boot.id,
      title: boot.title,
      meta: boot.meta,
      features: boot.features,
      lib: {
        assets: boot.assets,
        fonts: boot.fonts,
        intros: boot.intros,
        videos: boot.videos ?? [],
        music: boot.music,
        categories: boot.categories,
      },
      statusChoices: boot.statusChoices ?? [],
      doc: boot.document,
      fields: boot.fields,
    }),

  commit: (change, opts) => {
    const state = get()
    const next = change(state.doc)
    if (next === state.doc) return
    const now = Date.now()
    const burst = !!opts?.coalesce && state.coalesce?.key === opts.coalesce && now - state.coalesce.at < COALESCE_MS
    set({
      doc: next,
      history: burst ? state.history : [...state.history, state.doc].slice(-HISTORY_MAX),
      future: [],
      coalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null,
      selected: keepSelection(next, state.selected),
      selOverlay: keepOverlay(next, state.selOverlay),
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
      rev: state.rev + 1,
      contentRev: state.contentRev + contentChanged(state.doc, next),
    })
  },

  selectElement: (blockId, slot) =>
    set((state) => ({
      selected: blockId,
      selectSource: 'preview',
      selEl: slot ? { blockId, slot } : null,
      selOverlay: null,
      // الافتتاحية مالهاش صف في قايمة الأقسام: عنصرها المتحدّد بيتعرض في الخصائص (وإلا المستخدم مايلاقيش حاجة)
      tab: slot && blockId === INTRO_ID ? 'inspector' : state.tab,
    })),

  selectOverlay: (blockId, index) =>
    set({
      selected: blockId,
      selectSource: 'preview',
      selEl: null,
      selOverlay: index === null ? null : { blockId, index },
      // اتحدّد عنصر: لوحة خصائصه تفتح جنب المعاينة
      tab: index === null ? get().tab : 'inspector',
    }),

  removeOverlay: () => {
    const sel = get().selOverlay
    if (!sel) return
    const list = findBlock(get().doc, sel.blockId)?.props.text_overlays
    if (!Array.isArray(list)) return
    get().commit((d) =>
      ops.setBlockProp(
        d,
        sel.blockId,
        'text_overlays',
        list.filter((_, i) => i !== sel.index),
      ),
    )
    set({ selOverlay: null })
  },

  duplicateOverlay: () => {
    const sel = get().selOverlay
    if (!sel) return
    const list = findBlock(get().doc, sel.blockId)?.props.text_overlays
    if (!Array.isArray(list) || !list[sel.index]) return
    const source = list[sel.index] as Record<string, unknown>
    // النسخة بتنزل تحت الأصل بشوية، وإلا هتقعد فوقه بالظبط والمستخدم مايحسّش إنها اتعملت
    const copy = { ...JSON.parse(JSON.stringify(source)), y: (Number(source.y) || 0) + DUPLICATE_OFFSET }
    const next = list.slice()
    next.splice(sel.index + 1, 0, copy)
    get().commit((d) => ops.setBlockProp(d, sel.blockId, 'text_overlays', next))
    set({ selOverlay: { blockId: sel.blockId, index: sel.index + 1 } })
  },

  setHtml: (id, html, silent = false) => {
    const state = get()
    const block = findBlock(state.doc, id)
    // المعاينة المترجَمة نصها مترجَم — مانكتبش منها فوق الأصل
    if (!block || block.props.html === html || translatedPreview(state)) return
    if (!silent) return state.commit((d) => ops.setBlockProp(d, id, 'html', html), { coalesce: `html:${id}` })
    // ترقيم تلقائي: بيترسّب في النص من غير ما يبقى خطوة تراجع (مش تعديل من المستخدم)
    set({
      doc: ops.setBlockProp(state.doc, id, 'html', html),
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
      rev: state.rev + 1,
      contentRev: state.contentRev + 1,
    })
  },

  copyElement: () => {
    const target = elementTarget(get())
    const clip = target && element.copyOf(target.html, target.slot)
    if (!clip) return 'missing'
    set({ clip })
    return 'ok'
  },
  pasteElement: (inside = false) => {
    const clip = get().clip
    return clip ? runEdit((t) => element.pasteOf(t.html, t.slot, clip, inside)) : 'empty'
  },
  duplicateElement: () => runEdit((t) => element.duplicateOf(t.html, t.slot)),
  deleteElement: (slot) => runEdit((t) => element.deleteOf(t.html, t.slot), slot),
  addElement: (kind, value) => runEdit((t) => element.addOf(t.html, t.slot, kind, value)),
  editElement: (edit, coalesce) => {
    const outcome = runEdit((t) => element.editOf(t.html, t.slot, edit), undefined, coalesce)
    const el = get().selEl
    if (outcome === 'ok' && el) set((state) => ({ lastEdit: { seq: (state.lastEdit?.seq ?? 0) + 1, id: el.blockId, slot: el.slot, edit } }))
    return outcome
  },
  selectParentElement: () => {
    const target = elementTarget(get())
    if (!target) return 'missing'
    const up = element.parentOf(target.html, target.slot)
    if (!up) return 'top'
    get().selectElement(target.blockId, up)
    return 'ok'
  },

  setOverlay: (id, index, values) => {
    const block = findBlock(get().doc, id)
    const list = block?.props.text_overlays
    if (!block || block.locked || !Array.isArray(list) || !list[index] || typeof list[index] !== 'object') return
    const next = list.map((item, at) => (at === index ? { ...(item as object), ...values } : item))
    get().commit((d) => ops.setBlockProp(d, id, 'text_overlays', next), { coalesce: `overlay:${id}:${index}` })
  },
  setIntroItem: (key, x, y) => {
    const raw = get().doc.settings.intro_item_positions
    let table: Record<string, unknown> = {}
    try {
      const parsed: unknown = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) table = parsed as Record<string, unknown>
    } catch {
      /* جدول بايظ: نبدأ من فاضي */
    }
    table[key] = { x, y }
    get().commit((d) => ops.setSetting(d, 'intro_item_positions', JSON.stringify(table)), { coalesce: `intro-item:${key}` })
  },
  applyCodeNumbers: (id, items) => {
    const state = get()
    const first = items[0]
    const source = first && sourceOf(state.doc, id, first.slot)
    if (!source) return
    const html = numberByPath(source.html, items)
    if (html === null) return
    // ترقيم تلقائي: بيترسّب في النص من غير ما يبقى خطوة تراجع (زي ترقيم القسم المستورد)
    set({
      doc: writeSource(state.doc, id, source, html),
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
      rev: state.rev + 1,
      contentRev: state.contentRev + 1,
    })
  },
  applyNodeEdits: (id, edits) => {
    const state = get()
    if (translatedPreview(state) || findBlock(state.doc, id)?.locked) return
    const slots = edits.map((e) => e.slot).join('+')
    // نفس العنصر بيتكتب فيه متتالي = خطوة واحدة (coalesce)، وتبديل صورتين = خطوة واحدة
    let doc = state.doc
    for (const { slot, edit } of edits) {
      const source = sourceOf(doc, id, slot)
      const result = source && element.editOf(source.html, slot, edit)
      if (source && result) doc = writeSource(doc, id, source, result.html)
    }
    if (doc === state.doc) return
    state.commit(() => doc, { coalesce: `node-edits:${id}:${slots}` })
  },

  toggleBounds: (id) => set((state) => ({ boundsBlock: state.boundsBlock === id ? null : id })),

  select: (id, source = 'list') =>
    set((state) => ({
      selected: id,
      // الإطار بيتبع القسم المحدَّد: تحديد قسم تاني بيقفله (زي القديم)
      boundsBlock: state.boundsBlock === id ? id : null,
      selectSource: id ? source : null,
      selEl: state.selEl && state.selEl.blockId === id ? state.selEl : null,
      selOverlay: state.selOverlay && state.selOverlay.blockId === id ? state.selOverlay : null,
      tab: id && source === 'list' ? 'inspector' : state.tab,
    })),
  setTab: (tab) => set({ tab }),
  setDevice: (device) => set({ device }),
  setPreviewLang: (previewLang) => set((state) => ({ previewLang, rev: state.rev + 1 })),
  setRenderedLang: (renderedLang) => set({ renderedLang }),

  addBlock: (spec) => {
    const { doc, selected, commit } = get()
    if (spec.singleton && doc.blocks.some((b) => b.type === spec.type)) return false
    const block = ops.makeBlock(spec)
    commit((d) => ops.insertBlock(d, block, selected))
    set({ selected: block.id, selectSource: 'list', tab: 'inspector' })
    return true
  },

  duplicate: (id) => {
    let newId: string | null = null
    get().commit((d) => {
      const result = ops.duplicateBlock(d, id)
      if (!result) return d
      newId = result.id
      return result.doc
    })
    if (newId) set({ selected: newId, selectSource: 'list' })
    return !!newId
  },

  remove: (id) => get().commit((d) => ops.removeBlock(d, id)),
  move: (fromId, toId) => get().commit((d) => ops.moveBlock(d, fromId, toId)),
  toggleVisible: (id) => get().commit((d) => ops.toggleVisible(d, id)),
  rename: (id, label) => get().commit((d) => ops.setBlockLabel(d, id, label), { coalesce: `label:${id}` }),
  setProp: (id, key, value) => {
    get().commit((d) => ops.setBlockProp(d, id, key, value), { coalesce: `prop:${id}:${key}` })
    if (typeof value === 'string') set((s) => ({ lastText: { seq: (s.lastText?.seq ?? 0) + 1, id, key, value } }))
  },
  setProps: (id, patch, coalesce) =>
    get().commit((d) => ops.setBlockProps(d, id, patch), coalesce ? { coalesce } : undefined),
  setStyle: (id, key, value) => get().commit((d) => ops.setBlockStyle(d, id, key, value), { coalesce: `style:${id}:${key}` }),
  setTheme: (key, value) => get().commit((d) => ops.setTheme(d, key, value), { coalesce: `theme:${key}` }),
  setSetting: (key, value) => get().commit((d) => ops.setSetting(d, key, value), { coalesce: `setting:${key}` }),

  setLayout: (id, slot, dx, dy) => {
    if (findBlock(get().doc, id)?.locked) return
    get().commit((d) => ops.setLayout(d, id, slot, dx, dy))
  },
  nudgeLayout: (id, slot, ddx, ddy) => {
    if (findBlock(get().doc, id)?.locked) return
    get().commit((d) => ops.nudgeLayout(d, id, slot, ddx, ddy), { coalesce: `layout:${id}:${slot}` })
  },
  resetLayout: (id) => get().commit((d) => ops.resetLayout(d, id)),

  setTranslation: (key, value) => {
    const lang = altLangOf(get().doc)
    get().commit((d) => ops.setTranslation(d, lang, key, value), { coalesce: `i18n:${lang}:${key}` })
  },
  setTranslationStyle: (key, field, value) => {
    const lang = altLangOf(get().doc)
    get().commit((d) => ops.setTranslationStyle(d, lang, key, field, value), { coalesce: `i18n-style:${lang}:${key}:${field}` })
  },
  clearTranslation: () => {
    const lang = altLangOf(get().doc)
    get().commit((d) => ops.clearTranslation(d, lang))
  },
  pruneTranslations: (live) =>
    set((state) => {
      const next = ops.pruneTranslations(state.doc, altLangOf(state.doc), live)
      if (next === state.doc) return {}
      return { doc: next, saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty', rev: state.rev + 1 }
    }),

  setEventField: (key, value) =>
    set((state) => {
      if (!state.fields || state.fields[key] === value) return {}
      const { [key]: _cleared, ...errors } = state.fieldErrors
      return {
        fields: { ...state.fields, [key]: value },
        fieldErrors: errors,
        saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
        rev: state.rev + 1,
        contentRev: state.contentRev + 1,
      }
    }),

  setAssets: (assets) => set((state) => ({ lib: { ...state.lib, assets } })),
  addAsset: (asset) =>
    set((state) => ({ lib: { ...state.lib, assets: [asset, ...state.lib.assets.filter((a) => a.id !== asset.id)] } })),
  removeAssets: (ids) =>
    set((state) => ({ lib: { ...state.lib, assets: state.lib.assets.filter((a) => !ids.includes(a.id)) } })),
  addFont: (font) =>
    set((state) => ({ lib: { ...state.lib, fonts: [...state.lib.fonts.filter((f) => f.id !== font.id), font] } })),

  undo: () =>
    set((state) => {
      const previous = state.history.at(-1)
      if (!previous) return {}
      return {
        doc: previous,
        history: state.history.slice(0, -1),
        future: [...state.future, state.doc],
        coalesce: null,
        selected: keepSelection(previous, state.selected),
        selEl: keepElement(previous, state.selEl),
        selOverlay: keepOverlay(previous, state.selOverlay),
        saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
        rev: state.rev + 1,
        instantRev: state.rev + 1,
        contentRev: state.contentRev + contentChanged(state.doc, previous),
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future.at(-1)
      if (!next) return {}
      return {
        doc: next,
        history: [...state.history, state.doc],
        future: state.future.slice(0, -1),
        coalesce: null,
        selected: keepSelection(next, state.selected),
        selEl: keepElement(next, state.selEl),
        selOverlay: keepOverlay(next, state.selOverlay),
        saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
        rev: state.rev + 1,
        instantRev: state.rev + 1,
        contentRev: state.contentRev + contentChanged(state.doc, next),
      }
    }),

  save: async () => {
    const start = get()
    if (!start.loaded || start.saveStatus === 'saving') return false
    set({ saveStatus: 'saving', saveError: '', fieldErrors: {} })
    try {
      const res = await postSave(start.mode, start.id, start.doc, start.fields)
      const now = get()
      // اتعدّل حاجة أثناء الحفظ؟ يفضل «غير محفوظ» والحفظ التلقائي الجاي بيلحقها
      const changed = now.rev !== start.rev
      set({
        saveStatus: changed ? 'dirty' : 'saved',
        savedAt: res.savedAt,
        meta: now.meta
          ? { ...now.meta, slug: res.slug, status: res.status || now.meta.status, publicUrl: res.publicUrl, clientFollowupUrl: res.clientFollowupUrl }
          : now.meta,
        // الرابط ممكن يتنضّف على السيرفر (مسافات/حروف كبيرة) — إلا لو اتغيّر أثناء الحفظ (زرار «تغيير الرابط»)
        fields: now.fields && now.fields.slug === start.fields?.slug ? { ...now.fields, slug: res.slug } : now.fields,
      })
      return true
    } catch (error) {
      const api = error instanceof ApiError ? error : null
      set({
        saveStatus: 'error',
        // رسالة السيرفر لو فيه؛ فاضي = الواجهة بتعرض نصها العام المترجم
        saveError: api?.message ?? '',
        fieldErrors: api?.fields ?? {},
      })
      return false
    }
  },
}))

/** يرجّع الستور لحالته الأولى (للاختبارات ولما المحرر يتقفل). */
export const resetEditor = () => useEditor.setState(initial(), false)
