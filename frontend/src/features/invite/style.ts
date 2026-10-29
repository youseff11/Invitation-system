import type { CSSProperties } from 'react'

/**
 * نص CSS (زي سمة ‎style‎) → object لـReact. التقسيم على ‎;‎ بيراعي علامات
 * التنصيص والأقواس: ‎url("a;b")‎ ماتتقطّعش.
 */
export function parseStyle(css: string | undefined | null): CSSProperties {
  const out: Record<string, string> = {}
  if (!css) return out as CSSProperties
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number) => {
    const decl = css.slice(start, end)
    const colon = decl.indexOf(':')
    if (colon > 0) {
      const name = decl.slice(0, colon).trim()
      const value = decl.slice(colon + 1).trim()
      if (name && value) out[propName(name)] = value
    }
    start = end + 1
  }
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) flush(i)
  }
  flush(css.length)
  return out as CSSProperties
}

function propName(name: string): string {
  if (name.startsWith('--')) return name
  const lower = name.toLowerCase()
  const camel = lower.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
  return lower.startsWith('-ms-') ? `ms${camel.slice(2)}` : camel[0] === '-' ? camel.slice(1) : camel
}

// ---------------------------------------------------------------- المقاسات المرنة
// نسخة من ‎templatetags/invite.py: _fluid‎ — المقاس بيتقاس مع عرض الدعوة.
const FLUID_REF = 760

/** يطبع الرقم زي ‎float‎ في بايثون (‎38 → "38.0"‎) عشان النص يطابق السيرفر. */
function py(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n)
}

function num(value: unknown): number {
  const n = Number(String(value ?? '').trim() || 0)
  return Number.isFinite(n) ? n : NaN
}

export function fluid(
  value: unknown,
  opts: { ref?: unknown; floor?: unknown; minRatio?: number } = {},
): string {
  const size = num(value)
  if (!(size > 0)) return '0px'
  const reference = num(opts.ref) || FLUID_REF
  let low = opts.floor === undefined ? 0 : num(opts.floor)
  if (!(low > 0)) low = size * (opts.minRatio ?? 0.52)
  low = Math.min(low, size)
  const preferred = (size / reference) * 100
  const r1 = (n: number) => Math.round(n * 10) / 10
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return `clamp(${py(r1(low))}px, ${py(r3(preferred))}cqw, ${py(r1(size))}px)`
}

/** ‎{{ value }}‎ جوّه ‎{% localize off %}‎: نص من غير تنسيق أرقام. */
export function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}
