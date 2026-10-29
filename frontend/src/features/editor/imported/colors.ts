/**
 * ألوان القسم المستورد (S4b): القالب الجاهز بيحط ألوانه في CSS والـstyle المضمّن، فبنجمع كل لون مكتوب
 * ونعرضه كـswatch، وتغييره بيبدّله في كل مكان مذكور فيه (‎props.css‎ و‎props.html‎). منقول من ‎collectColors/replaceColor‎ القديم.
 */
const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g
const RGB = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)/g

export interface ColorUse {
  /** اللون موحَّد ‎#rrggbb‎ */
  hex: string
  count: number
  /** كل الأشكال اللي اتكتب بيها في النص (‎#abc‎، ‎rgb(…)‎…) — دي اللي بتتبدّل */
  raws: string[]
}

const hex6 = (value: string) =>
  value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase() : value.toLowerCase()

function rgbToHex(value: string): string | null {
  const parts = value.match(/\d{1,3}/g)
  if (!parts || parts.length < 3) return null
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** كل الألوان في ‎css + html‎ مرتّبة بعدد مرات ظهورها (الأكتر أول)، لحد ١٢ لون. */
export function collectColors(css: string, html: string, limit = 12): ColorUse[] {
  const text = `${css}\n${html}`
  const found = new Map<string, { n: number; raws: Set<string> }>()
  const add = (raw: string, key: string | null) => {
    if (!key) return
    const entry = found.get(key) ?? { n: 0, raws: new Set<string>() }
    entry.n++
    entry.raws.add(raw)
    found.set(key, entry)
  }
  for (const v of text.match(HEX) ?? []) add(v, hex6(v))
  for (const v of text.match(RGB) ?? []) add(v, rgbToHex(v))
  return Array.from(found.entries())
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([hex, { n, raws }]) => ({ hex, count: n, raws: Array.from(raws) }))
}

/** يبدّل كل ‎raws‎ بـ‎next‎ في النص (بدل حرفي، مش regex). */
export function replaceColor(text: string, raws: readonly string[], next: string): string {
  let out = text
  for (const raw of raws) if (raw) out = out.split(raw).join(next)
  return out
}
