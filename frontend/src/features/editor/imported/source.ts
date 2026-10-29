import { findBlock, INTRO_ID, setBlockSource, setSetting, dropIntroLayout } from '../doc'
import type { EditorDocument } from '../types'
import { findSlot, out, parse } from './dom'

export { INTRO_ID }

/**
 * مصادر نص العناصر المرقّمة (S5): قسم مستورد ← ‎props.html‎ (عناصره ‎el-N‎)، و«كود متقدّم» ← ‎props.code‎ (عناصره ‎ce-N‎
 * والصندوق نفسه ‎code‎)، وكود الافتتاحية ← ‎settings.intro_code‎ (بلوك وهمي ‎__intro‎). الخانة بتتحدّد من رقم العنصر.
 *
 * خانة الكود نص واحد فيه ‎<style>‎ وHTML و‎<script>‎: بنشتغل على جزء الـHTML بس (‎region‎) وبنرجّعه مكانه
 * (الستايل أولاً والسكربت آخراً — زي القديم). الستايل والسكربت الأصليين بيتحفظوا بالنص زي ما هم.
 */
export type SourceKind = 'html' | 'code'

/** رقم العنصر ← خانته: ‎ce-N‎ والصندوق ‎code‎ في خانة الكود، والباقي (‎el-N‎…) في ‎props.html‎. */
export const slotKind = (slot: string): SourceKind => (slot === 'code' || /^ce-\d{1,4}$/.test(slot) ? 'code' : 'html')

const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi

/** يفصل خانة الكود: الـHTML (من غير ستايل وسكربت) والستايلات والسكربتات بترتيبها. */
export function splitCode(code: string): { region: string; styles: string[]; scripts: string[] } {
  return {
    region: code.replace(STYLE_BLOCK, '').replace(SCRIPT_BLOCK, ''),
    styles: code.match(STYLE_BLOCK) ?? [],
    scripts: code.match(SCRIPT_BLOCK) ?? [],
  }
}

/** يرجّع خانة الكود بعد تعديل جزء الـHTML: ستايل ثم HTML ثم سكربت، من غير الأجزاء الفاضية. */
export function rebuildCode(original: string, region: string): string {
  const { styles, scripts } = splitCode(original)
  return [...styles, region.trim(), ...scripts].filter((part) => part.trim()).join('\n')
}

export interface Source {
  kind: SourceKind
  /** النص الكامل للخانة */
  original: string
  /** الجزء اللي بنعدّل فيه: ‎props.html‎ كله، أو جزء الـHTML من خانة الكود */
  html: string
}

/** مصدر عنصر في مستند — ‎null‎ لو القسم/الخانة مش موجودين. */
export function sourceOf(doc: EditorDocument, blockId: string, slot: string): Source | null {
  const kind = slotKind(slot)
  if (blockId === INTRO_ID) {
    if (kind !== 'code' || typeof doc.settings.intro_code !== 'string') return null
    return { kind, original: doc.settings.intro_code, html: splitCode(doc.settings.intro_code).region }
  }
  const block = findBlock(doc, blockId)
  const value = block?.props[kind === 'code' ? 'code' : 'html']
  if (typeof value !== 'string') return null
  return { kind, original: value, html: kind === 'code' ? splitCode(value).region : value }
}

/** يكتب جزء الـHTML المعدَّل في خانته ويمسح مواضع العناصر اللي اتشالت (‎dropped‎) — لقطة واحدة. */
export function writeSource(doc: EditorDocument, blockId: string, source: Source, html: string, dropped: readonly string[] = []): EditorDocument {
  const next = source.kind === 'code' ? rebuildCode(source.original, html) : html
  if (blockId === INTRO_ID) return dropIntroLayout(setSetting(doc, 'intro_code', next), dropped)
  return setBlockSource(doc, blockId, source.kind === 'code' ? 'code' : 'html', next, dropped)
}

export interface PathItem {
  /** أرقام الأبناء من صندوق الكود لحد العنصر */
  path: number[]
  slot: string
  tag: string
}

/**
 * يكتب ‎data-move‎ على عناصر في **النص الأصلي** بالمسار — مش بحفظ الـDOM الحي: سكربت المصمّم بيغيّر الـDOM وهو
 * شغال (عدّاد بيكتب أرقام، حركة دخول بتحط class)، ولو حفظنا لقطة اللحظة دي كانت هتتخبّط في الكود للأبد
 * (وإعادة العرض بتشغّل الأنيميشن من الأول ⇒ ترقيم تاني ⇒ لفة لا نهائية). مسار ضايع أو وسم مختلف = بنتخطّى العنصر
 * (أحسن من الكتابة في المكان الغلط). بيرجّع ‎null‎ لو مفيش حاجة اتغيّرت.
 */
export function numberByPath(region: string, items: readonly PathItem[]): string | null {
  const root = parse(region, 'code')
  let changed = false
  for (const item of items) {
    let node: Element | null = root
    for (const index of item.path) {
      node = node.children[index] ?? null
      if (!node) break
    }
    if (!node || node === root || node.tagName.toUpperCase() !== item.tag.toUpperCase()) continue
    if (node.hasAttribute('data-move') || findSlot(root, item.slot)) continue
    node.setAttribute('data-move', item.slot)
    changed = true
  }
  return changed ? out(root) : null
}
