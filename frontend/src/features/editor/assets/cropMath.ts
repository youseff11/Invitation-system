/**
 * حسابات مربع القص — دوال نقية (بالبكسل جوّه المسرح) عشان تتختبر من غير متصفح.
 * مطابقة لـ‎setBox‎ وسحب المقابض في ‎openCropper‎ القديمة.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** أقل مقاس للمربع (بكسل) — أصغر من كده المقبض بيختفي */
export const MIN_BOX = 24

export type Handle = 'nw' | 'ne' | 'sw' | 'se' | null

/** ‎bounds‎ = مستطيل الصورة جوّه المسرح. المربع مايخرجش منه. */
export function clampBox(box: Box, bounds: Box): Box {
  const w = Math.max(MIN_BOX, Math.min(box.w, bounds.w))
  const h = Math.max(MIN_BOX, Math.min(box.h, bounds.h))
  return {
    x: Math.max(bounds.x, Math.min(box.x, bounds.x + bounds.w - w)),
    y: Math.max(bounds.y, Math.min(box.y, bounds.y + bounds.h - h)),
    w,
    h,
  }
}

/** مربع البداية: ٨٠٪ من الصورة في النص. */
export function initialBox(bounds: Box): Box {
  const w = bounds.w * 0.8
  const h = bounds.h * 0.8
  return clampBox({ x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h }, bounds)
}

/** سحب المربع كله (من غير مقبض) أو تغيير مقاسه من ركن. ‎ratio‎ = عرض/ارتفاع، ٠ = حر. */
export function dragBox(start: Box, handle: Handle, dx: number, dy: number, ratio: number, bounds: Box): Box {
  if (!handle) return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
  let { x, y, w, h } = start
  if (handle.includes('e')) w = start.w + dx
  if (handle.includes('s')) h = start.h + dy
  if (handle.includes('w')) {
    x = start.x + dx
    w = start.w - dx
  }
  if (handle.includes('n')) {
    y = start.y + dy
    h = start.h - dy
  }
  if (ratio) h = w / ratio
  return clampBox({ x, y, w, h }, bounds)
}

/** تغيير نسبة العرض للارتفاع مع إبقاء الركن العلوي ثابت. */
export function applyRatio(box: Box, ratio: number, bounds: Box): Box {
  return ratio ? clampBox({ ...box, h: box.w / ratio }, bounds) : box
}

/** حدود القص كنِسَب من الصورة (٠..١) — السيرفر بيقص من الأصل فالمقاس المعروض ماله لازمة. */
export function toRatios(box: Box, bounds: Box): Box {
  return {
    x: (box.x - bounds.x) / bounds.w,
    y: (box.y - bounds.y) / bounds.h,
    w: box.w / bounds.w,
    h: box.h / bounds.h,
  }
}

export const RATIOS: { key: string; ratio: number }[] = [
  { key: 'free', ratio: 0 },
  { key: '1:1', ratio: 1 },
  { key: '4:5', ratio: 4 / 5 },
  { key: '3:2', ratio: 3 / 2 },
  { key: '16:9', ratio: 16 / 9 },
]
