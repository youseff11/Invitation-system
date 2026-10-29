import type { BlockSpec, DocBlock, EditorDocument, FieldSpec, LayoutPos, Props, TranslationStyle } from './types'

/**
 * عمليات المستند — دوال نقية (من غير تعديل في المكان) عشان التاريخ يبقى لقطات رخيصة.
 * المنطق مطابق لـ‎editor.js‎ القديم: ‎uid‎، ‎defaultsFor‎، ‎addBlock‎، التكرار، السحب.
 */

export function newBlockId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`
}

const clone = <T,>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

/** القيم الافتراضية لقايمة حقول — نسخة جديدة لكل قسم (القوايم والكائنات ما تتشاركش). */
export function defaultsFor(specs: FieldSpec[] | undefined): Props {
  const out: Props = {}
  for (const spec of specs ?? []) out[spec.key] = clone(spec.default)
  return out
}

export function makeBlock(spec: BlockSpec): DocBlock {
  return {
    id: newBlockId(spec.type),
    type: spec.type,
    visible: true,
    locked: false,
    props: defaultsFor(spec.props),
    style: defaultsFor(spec.style),
  }
}

export const blockIndex = (doc: EditorDocument, id: string) => doc.blocks.findIndex((b) => b.id === id)

export const findBlock = (doc: EditorDocument, id: string | null | undefined): DocBlock | null =>
  (id && doc.blocks.find((b) => b.id === id)) || null

function withBlocks(doc: EditorDocument, blocks: DocBlock[]): EditorDocument {
  return { ...doc, blocks }
}

function mapBlock(doc: EditorDocument, id: string, change: (block: DocBlock) => DocBlock): EditorDocument {
  let touched = false
  const blocks = doc.blocks.map((block) => {
    if (block.id !== id) return block
    const next = change(block)
    if (next !== block) touched = true
    return next
  })
  return touched ? withBlocks(doc, blocks) : doc
}

/** يضيف القسم بعد القسم المحدد (أو في الآخر لو مفيش تحديد) — زي ‎addBlock‎ القديمة. */
export function insertBlock(doc: EditorDocument, block: DocBlock, afterId?: string | null): EditorDocument {
  const after = afterId ? blockIndex(doc, afterId) : -1
  const at = after >= 0 ? after + 1 : doc.blocks.length
  const blocks = doc.blocks.slice()
  blocks.splice(at, 0, block)
  return withBlocks(doc, blocks)
}

/** نسخة بمعرّف جديد بعد الأصل مباشرة. ‎null‎ لو القسم مش موجود. */
export function duplicateBlock(doc: EditorDocument, id: string): { doc: EditorDocument; id: string } | null {
  const at = blockIndex(doc, id)
  if (at < 0) return null
  const source = doc.blocks[at]
  const copy: DocBlock = { ...clone(source), id: newBlockId(source.type) }
  const blocks = doc.blocks.slice()
  blocks.splice(at + 1, 0, copy)
  return { doc: withBlocks(doc, blocks), id: copy.id }
}

export function removeBlock(doc: EditorDocument, id: string): EditorDocument {
  const at = blockIndex(doc, id)
  if (at < 0) return doc
  return withBlocks(doc, doc.blocks.filter((b) => b.id !== id))
}

/** ينقل القسم من مكانه لمكان قسم تاني (نفس ‎splice(to, 0, splice(from, 1))‎ القديمة). */
export function moveBlock(doc: EditorDocument, fromId: string, toId: string): EditorDocument {
  const from = blockIndex(doc, fromId)
  const to = blockIndex(doc, toId)
  if (from < 0 || to < 0 || from === to) return doc
  const blocks = doc.blocks.slice()
  blocks.splice(to, 0, blocks.splice(from, 1)[0])
  return withBlocks(doc, blocks)
}

export const toggleVisible = (doc: EditorDocument, id: string) =>
  mapBlock(doc, id, (block) => ({ ...block, visible: !block.visible }))

export const setBlockLabel = (doc: EditorDocument, id: string, label: string) =>
  mapBlock(doc, id, (block) => {
    const next = { ...block }
    if (label) next.label = label
    else delete next.label
    return next
  })

export const setBlockProp = (doc: EditorDocument, id: string, key: string, value: unknown) =>
  mapBlock(doc, id, (block) => ({ ...block, props: { ...block.props, [key]: value } }))

/** معرّف بلوك الافتتاحية الوهمي: مش في ‎doc.blocks‎ — كودها في ‎settings.intro_code‎ وإزاحاتها في ‎settings.intro_code_layout‎ (JSON). */
export const INTRO_ID = '__intro'

/**
 * نص خانة جديد (‎html‎ لقسم مستورد أو ‎code‎ لـ«كود متقدّم») مع مسح مواضع عناصر اتشالت (‎dropped‎) — في نفس اللقطة،
 * فخطوة تراجع واحدة بترجّع النص والمواضع مع بعض.
 */
export function setBlockSource(
  doc: EditorDocument,
  id: string,
  key: 'html' | 'code',
  value: string,
  dropped: readonly string[] = [],
): EditorDocument {
  return mapBlock(doc, id, (block) => {
    const next: DocBlock = { ...block, props: { ...block.props, [key]: value } }
    if (block.layout && dropped.some((slot) => slot in block.layout!)) {
      const layout = { ...block.layout }
      for (const slot of dropped) delete layout[slot]
      if (Object.keys(layout).length) next.layout = layout
      else delete next.layout
    }
    return next
  })
}

export const setBlockHtml = (doc: EditorDocument, id: string, html: string, dropped: readonly string[] = []) =>
  setBlockSource(doc, id, 'html', html, dropped)

/** عدّة ‎props‎ دفعة واحدة في لقطة واحدة (استبدال لون بيمس ‎css‎ و‎html‎ مع بعض). */
export const setBlockProps = (doc: EditorDocument, id: string, patch: Props) =>
  mapBlock(doc, id, (block) => ({ ...block, props: { ...block.props, ...patch } }))

export const setBlockStyle = (doc: EditorDocument, id: string, key: string, value: unknown) =>
  mapBlock(doc, id, (block) => ({ ...block, style: { ...block.style, [key]: value } }))

export const setTheme = (doc: EditorDocument, key: string, value: unknown): EditorDocument => ({
  ...doc,
  theme: { ...doc.theme, [key]: value },
})

export const setSetting = (doc: EditorDocument, key: string, value: unknown): EditorDocument => ({
  ...doc,
  settings: { ...doc.settings, [key]: value },
})

// ---------------------------------------------------------------- مواضع العناصر (layout)
const round2 = (n: number) => Math.round(n * 100) / 100

/** جدول إزاحات عناصر كود الافتتاحية: JSON في ‎settings.intro_code_layout‎ بنفس شكل ‎block.layout‎. */
export function introLayout(doc: EditorDocument): Record<string, LayoutPos> {
  const raw = doc.settings.intro_code_layout
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const table: unknown = JSON.parse(raw)
    return table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, LayoutPos>) : {}
  } catch {
    return {}
  }
}

const writeIntroLayout = (doc: EditorDocument, table: Record<string, LayoutPos>) =>
  setSetting(doc, 'intro_code_layout', Object.keys(table).length ? JSON.stringify(table) : '')

/** إزاحات بلوك (أو الافتتاحية) — فاضي لو مفيش. */
export const layoutOf = (doc: EditorDocument, id: string): Record<string, LayoutPos> =>
  id === INTRO_ID ? introLayout(doc) : (findBlock(doc, id)?.layout ?? {})

/** يمسح إزاحات عناصر اتشالت من جدول الافتتاحية (لو ماكانش فيها حاجة مايغيّرش المستند). */
export function dropIntroLayout(doc: EditorDocument, dropped: readonly string[]): EditorDocument {
  const table = introLayout(doc)
  if (!dropped.some((slot) => slot in table)) return doc
  for (const slot of dropped) delete table[slot]
  return writeIntroLayout(doc, table)
}

/** يكتب إزاحة عنصر (cqw، أو بكسل لعناصر القالب المستورد والكود). الصفر في الاتنين = رجوع للأصل فبنشيله، والـlayout الفاضي بيتشال كله. */
export function setLayout(doc: EditorDocument, id: string, slot: string, dx: number, dy: number): EditorDocument {
  const pos = { dx: round2(dx), dy: round2(dy) }
  if (id === INTRO_ID) {
    const table = { ...introLayout(doc) }
    if (!pos.dx && !pos.dy) delete table[slot]
    else table[slot] = pos
    return writeIntroLayout(doc, table)
  }
  return mapBlock(doc, id, (block) => {
    const layout: Record<string, LayoutPos> = { ...block.layout }
    if (!pos.dx && !pos.dy) delete layout[slot]
    else layout[slot] = pos
    const next = { ...block }
    if (Object.keys(layout).length) next.layout = layout
    else delete next.layout
    return next
  })
}

export function nudgeLayout(doc: EditorDocument, id: string, slot: string, ddx: number, ddy: number): EditorDocument {
  const current = layoutOf(doc, id)[slot] ?? { dx: 0, dy: 0 }
  return setLayout(doc, id, slot, current.dx + ddx, current.dy + ddy)
}

export function resetLayout(doc: EditorDocument, id: string): EditorDocument {
  if (id === INTRO_ID) return writeIntroLayout(doc, {})
  return mapBlock(doc, id, (block) => {
    if (!block.layout) return block
    const next = { ...block }
    delete next.layout
    return next
  })
}

// ---------------------------------------------------------------- الترجمة اليدوية
/** نص مترجَم لمفتاح. الفاضي = «مترجمش» فبنشيل المفتاح (زي ‎_clean_i18n‎ على السيرفر). */
export function setTranslation(doc: EditorDocument, lang: string, key: string, value: string): EditorDocument {
  const table = { ...doc.i18n?.[lang] }
  const text = value.trim()
  if (text) table[key] = text
  else delete table[key]
  return { ...doc, i18n: { ...doc.i18n, [lang]: table } }
}

/** تنسيق (خط/حجم) نص مترجَم. الفاضي أو صفر = «زي الأصل» فبنشيله، والمفتاح الفاضي بيتشال. */
export function setTranslationStyle(
  doc: EditorDocument,
  lang: string,
  key: string,
  field: keyof TranslationStyle,
  value: string | number,
): EditorDocument {
  const table = { ...doc.i18n_style?.[lang] }
  const row: TranslationStyle = { ...table[key] }
  if (value === '' || value === null || value === undefined || (field === 'size' && !Number(value))) delete row[field]
  else if (field === 'size') row.size = Number(value)
  else row.font = String(value)
  if (Object.keys(row).length) table[key] = row
  else delete table[key]
  return { ...doc, i18n_style: { ...doc.i18n_style, [lang]: table } }
}

export function clearTranslation(doc: EditorDocument, lang: string): EditorDocument {
  return { ...doc, i18n: { ...doc.i18n, [lang]: {} }, i18n_style: { ...doc.i18n_style, [lang]: {} } }
}

/**
 * يشيل مفاتيح الترجمة والتنسيق اللي نصها اتغيّر أو اتمسح (ميّتة) — من غيره العدّاد بيكدّب وزرار اللغة
 * بيظهر للضيف بسبب ترجمة لقسم اتحذف. بيرجّع نفس الكائن لو مفيش حاجة تتشال.
 */
export function pruneTranslations(doc: EditorDocument, lang: string, live: ReadonlySet<string>): EditorDocument {
  const text = doc.i18n?.[lang] ?? {}
  const styles = doc.i18n_style?.[lang] ?? {}
  const deadText = Object.keys(text).filter((k) => !live.has(k))
  const deadStyle = Object.keys(styles).filter((k) => !live.has(k))
  if (!deadText.length && !deadStyle.length) return doc
  return {
    ...doc,
    i18n: { ...doc.i18n, [lang]: Object.fromEntries(Object.entries(text).filter(([k]) => live.has(k))) },
    i18n_style: { ...doc.i18n_style, [lang]: Object.fromEntries(Object.entries(styles).filter(([k]) => live.has(k))) },
  }
}
