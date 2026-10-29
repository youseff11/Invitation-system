/**
 * ضغط الصورة في المتصفح قبل الرفع: صورة هيرو من الكاميرا أو التصميم بتبقى كذا ميجا، فنصغّرها (أطول ضلع ٢٤٠٠px)
 * ونحوّلها WebP بجودة ٨٠٪ قبل ما تتبعت — الرفع أسرع والسيرفر بيضغط تاني كخط دفاع تاني.
 * أي حاجة مش مناسبة (SVG، GIF متحرك، ملف صغير أصلاً، متصفح ناقص) بترجع زي ما هي.
 */
export const MAX_EDGE = 2400
export const SKIP_BELOW = 400 * 1024
const QUALITY = 0.8
const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif', 'image/webp'])

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file
  if (file.size < SKIP_BELOW && file.type !== 'image/png') return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file) // بيطبّق اتجاه EXIF لوحده
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    // لو الناتج مش أصغر (صورة صغيرة أصلاً) نفضل على الأصل
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: Date.now() })
  } catch {
    return file
  }
}
