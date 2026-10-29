/** مساعدات قراءة قيم CSS للّوحة (نقية — مفيش DOM). */

/** المتصفح بيعيد كتابة ‎font-family‎ بعلامات تنصيص مختلفة — فالمقارنة بعد التطبيع. */
export const fontKey = (value: string) => value.replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** ‎rgb(17, 34, 51)‎ ← ‎#112233‎ (عشان مدخل اللون ما يبانش فاضي)؛ أي شكل تاني (شفافية، اسم لون…) زي ما هو. */
export function toHex(value: string): string {
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim())
  if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) return value
  return `#${[match[1], match[2], match[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
}

/** رقم من قيمة CSS (‎'24px'‎ ← ‎24‎)، أو ‎null‎ لو مش رقم (‎'normal'‎، فاضي). */
export function cssNumber(value: string): number | null {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** ‎line-height‎ المحسوب بالبكسل ← نسبة من حجم الخط (الشريط بالنسبة). */
export const lineRatio = (lineHeightPx: number, fontSizePx: number) => round(lineHeightPx / (fontSizePx || 16), 2)
