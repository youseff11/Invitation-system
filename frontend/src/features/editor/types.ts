/**
 * أنواع المحرر — بتطابق ‎system/api/editor.py‎ و‎system/blocks.py‎.
 *
 * مستند الدعوة والسكيما بيوصلوا بمفاتيح المحرك (‎snake_case‎) زي ما هم: دي بيانات
 * المحرك نفسه مش واجهة، والمستند بيرجع للسيرفر كما هو. الأغلفة (‎Bootstrap‎ …) camelCase.
 */

import type { RenderPayload } from '@/features/invite/types'

import type { NodeEdit } from './imported/nodeEdit'

export type EditorMode = 'invitation' | 'template'
export type Device = 'mobile' | 'tablet' | 'desktop'

// ---------------------------------------------------------------- السكيما
export type FieldType =
  | 'text'
  | 'textarea'
  | 'html'
  | 'number'
  | 'range'
  | 'color'
  | 'select'
  | 'toggle'
  | 'image'
  | 'media'
  | 'url'
  | 'date'
  | 'datetime'
  | 'font'
  | 'align'
  | 'list'
  | 'gradient'
  | 'icon'

export interface FieldOption {
  value: string
  label: string
}

export interface AddVariant {
  key: string
  value: string
  label: string
  seed?: Record<string, unknown>
}

export interface FieldSpec {
  key: string
  label: string
  type: FieldType
  default: unknown
  group: string
  media_kind?: 'image' | 'audio' | 'video'
  help?: string
  options?: FieldOption[]
  fields?: FieldSpec[]
  add_label?: string
  add_variants?: AddVariant[]
  min?: number
  max?: number
  step?: number
  unit?: string
  placeholder?: string
  feature?: string
  translate?: boolean
  /** حقل لون بزرار «مسح» (الافتراضي لـ‎bg_color‎ بس) */
  clearable?: boolean
  translate_units?: boolean
  editor_hidden?: boolean
  group_open?: boolean
  /** حقول عنصر القايمة اللي بتظهر لأنواع معيّنة بس (نص/صورة/زرار) */
  show_kind?: string[]
  style_of?: string
  style_role?: string
}

export interface BlockSpec {
  type: string
  label: string
  icon: string
  description: string
  category: string
  props: FieldSpec[]
  style: FieldSpec[]
  feature: string
  singleton: boolean
}

export interface EditorSchema {
  version: number
  blocks: Record<string, BlockSpec>
  theme_fields: FieldSpec[]
  settings_fields: FieldSpec[]
  fonts: FieldOption[]
  animations: FieldOption[]
  dividers: FieldOption[]
  layout_max: { x: number; y: number }
}

// ---------------------------------------------------------------- المستند
export type Props = Record<string, unknown>

export interface DocBlock {
  id: string
  type: string
  visible: boolean
  locked: boolean
  /** اسم كتبه المستخدم — بيظهر في قايمة الأقسام بدل اسم النوع */
  label?: string
  props: Props
  style: Props
  /** إزاحات العناصر (cqw) اللي المستخدم سحبها: ‎{slot: {dx, dy}}‎ */
  layout?: Record<string, LayoutPos>
}

export interface LayoutPos {
  dx: number
  dy: number
}

/** تنسيق نص مترجَم لوحده (خط/حجم) — ‎{مفتاح النص: {font?, size?}}‎ */
export interface TranslationStyle {
  font?: string
  size?: number
}

export interface EditorDocument {
  version: number
  theme: Props
  settings: Props
  blocks: DocBlock[]
  /** الترجمة اليدوية: ‎{لغة: {مفتاح: نص}}‎ — شكل المفتاح بيطابق ‎blocks.translatable_entries‎ */
  i18n?: Record<string, Record<string, string>>
  i18n_style?: Record<string, Record<string, TranslationStyle>>
  [extra: string]: unknown
}

// ---------------------------------------------------------------- الواجهة
/** بيانات المناسبة (camelCase) — تتحفظ مع المستند. ‎null‎ في محرر القالب. */
export interface EventFields {
  title: string
  eventType: string
  nameOne: string
  nameTwo: string
  eventDate: string
  venue: string
  address: string
  mapUrl: string
  whatsapp: string
  status: string
  expiresAt: string
  password: string
  slug: string
}

export type AssetKind = 'image' | 'audio' | 'video'

export interface AssetRow {
  id: number
  url: string
  thumb: string
  source: string
  name: string
  kind: AssetKind
  used: boolean
  /** بيجوا مع رد الرفع/القص بس، مش مع القايمة */
  width?: number
  height?: number
  seconds?: number
}

/** قسم محفوظ في مكتبة المفضلة (مشتركة بين الدعوات والقوالب). */
export interface FavoriteRow {
  id: number
  name: string
  blockType: string
  block: DocBlock
}

export interface IntroRow {
  id: number
  name: string
  url: string
  poster: string
  seconds: number
  note: string
}

export interface MusicRow {
  id: number
  name: string
  url: string
  note: string
}

export interface FontRow {
  id: number
  name: string
  nameEn: string
  label: string
  value: string
  family: string
  url: string
  weight: string | number
  style: string
}

export interface TranslationRow {
  key: string
  label: string
  value: string
  group: string
}

export interface TranslationRows {
  baseLang: 'ar' | 'en'
  altLang: 'ar' | 'en'
  entries: TranslationRow[]
}

export interface EditorMeta {
  slug: string
  status: string
  planName: string
  templateName: string
  publicUrl: string
  clientFollowupUrl: string
  backUrl: string
}

export interface Bootstrap {
  mode: EditorMode
  id: number
  title: string
  document: EditorDocument
  fields: EventFields | null
  features: string[]
  assets: AssetRow[]
  fonts: FontRow[]
  intros: IntroRow[]
  /** مكتبة الفيديوهات العادية (غير الافتتاحيات) */
  videos?: IntroRow[]
  music: MusicRow[]
  categories: { value: string; label: string }[]
  /** خيارات حالة الدعوة (من ‎Invitation.STATUS_CHOICES‎) — محرر الدعوة بس */
  statusChoices?: FieldOption[]
  meta: EditorMeta
}

export interface SaveResponse {
  savedAt: string
  slug: string
  status: string
  publicUrl: string
  clientFollowupUrl: string
}

/** حمولة المعاينة = حمولة عارض الدعوة من غير الميتا والموسيقى والتمرير (مالهمش لازمة في المحرر). */
export type PreviewPayload = Omit<RenderPayload, 'head' | 'music' | 'scroll' | 'cta' | 'demo' | 'slug'> & {
  editable: true
}

/** رسائل الـiframe ↔ الصفحة الأم (‎postMessage‎، نفس الأصل) */
export const FRAME_PREFIX = 'lb-editor:'
export type ToFrame =
  /** ‎force‎: تراجع/إعادة — الرسمة تتطبّق حتى لو المستخدم جوّه نص (وإلا بتتأجّل لحد ما يسيبه) */
  | { type: 'lb-editor:render'; payload: unknown; selected: string | null; force?: boolean }
  /** نص اتكتب في خانة باللوحة: يتحط في المعاينة لحظياً قبل ما رد السيرفر يوصل */
  | { type: 'lb-editor:patch'; id: string; key: string; value: string }
  /** العنصر المحدَّد جوّه قسم مستورد (للعلامة ‎.lb-el-picked‎) */
  | { type: 'lb-editor:element'; id: string | null; slot: string | null }
  /** العنصر فوق القسم المحدَّد (للعلامة ‎.lb-ovl-picked‎) */
  | { type: 'lb-editor:overlay-pick'; id: string | null; index: number | null }
  /** تعديل من لوحة العنصر يتطبّق على العقدة الحية فوراً (ما بيكتبش حاجة راجعة) */
  | { type: 'lb-editor:node'; id: string; slot: string; edit: NodeEdit }
  | { type: 'lb-editor:select'; id: string | null; scroll: boolean }
  /** إطار حدود القسم ومقبض ارتفاعه (null = اخفِ): key = section_height_<مقاس>، stored المحفوظ (٠ = ماحدّش سحب) */
  | { type: 'lb-editor:bounds'; bounds: { id: string; key: string; label: string; stored: number } | null }
  /** زرار «الافتتاحية»: يعيد عرض الشاشة الافتتاحية فوق المعاينة */
  | { type: 'lb-editor:intro' }
  /** زرار «تخطّي الافتتاحية»: يفتح الدعوة بدل التلات ضغطات (نفس اللي بيعمله ‎__lbIntro.open‎) */
  | { type: 'lb-editor:intro-skip' }
export type FromFrame =
  | { type: 'lb-editor:ready' }
  /** الافتتاحية مغطّية المعاينة دلوقتي ولا لأ — عشان زرار التخطّي يظهر وقت الحاجة بس */
  | { type: 'lb-editor:intro-visible'; visible: boolean }
  | { type: 'lb-editor:select'; id: string }
  /** اختصارات لوحة المفاتيح اللي ضُغطت جوّه الـiframe (مابتوصلش للصفحة الأم) */
  | { type: 'lb-editor:key'; key: string; shiftKey: boolean; mod: boolean }
  /** كتابة مباشرة جوّه المعاينة */
  | { type: 'lb-editor:text'; id: string; key: string; value: string }
  /** سحب عنصر بالماوس: الإزاحة النهائية بوحدة cqw */
  | { type: 'lb-editor:layout'; id: string; slot: string; dx: number; dy: number }
  /** عنصر اتحدّد جوّه قسم مستورد */
  | { type: 'lb-editor:element'; id: string; slot: string }
  /** ضغطة على عنصر فوق القسم (index) أو على أي حاجة تانية (null) */
  | { type: 'lb-editor:overlay-pick'; id: string | null; index: number | null }
  /** ‎props.html‎ الجديد لقسم مستورد من الـDOM الحي. ‎silent‎ = ترقيم تلقائي (مش خطوة تراجع) */
  | { type: 'lb-editor:html'; id: string; value: string; silent: boolean }
  /** سحب عنصر فوق القسم (‎x/y‎ نسبة من حاويته) أو مقبض عرضه (‎width‎ نسبة) — بتتكتب في ‎props.text_overlays[index]‎ */
  | { type: 'lb-editor:overlay'; id: string; index: number; values: { x?: number; y?: number; width?: number } }
  /** سحب عنصر من الافتتاحية: ‎x/y‎ بوحدة ‎vw/vh‎ في ‎settings.intro_item_positions‎ */
  | { type: 'lb-editor:intro-item'; key: string; x: number; y: number }
  | { type: 'lb-editor:intro-text'; key: string; value: string }
  /** سحب مقبض ارتفاع القسم: الارتفاع النهائي (بكسل، لأقرب ١٠) للمقاس الحالي */
  | { type: 'lb-editor:section-height'; id: string; key: string; value: number }
  /** صندوق كود: أرقام ‎ce-N‎ اتحسبت على الـDOM الحي (مسار كل عنصر من الصندوق) — بتتكتب في النص الأصلي */
  | { type: 'lb-editor:code-number'; id: string; items: { path: number[]; slot: string; tag: string }[] }
  /** تعديلات بأرقام العناصر على النص الأصلي (كتابة وحدة نص، تبديل صورتين) — خطوة تراجع واحدة */
  | { type: 'lb-editor:node-edits'; id: string; edits: { slot: string; edit: NodeEdit }[] }
  /** الكتابة اتمنعت لأن المعاينة معروضة بالنسخة المترجَمة */
  | { type: 'lb-editor:refused' }
