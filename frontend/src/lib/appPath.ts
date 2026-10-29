import { boot } from '@/app/boot'

/**
 * مسار من السيرفر (‎editorUrl‎ …) بيجي بالـbasename؛ الـrouter بيضيفه لوحده فبنشيله
 * عشان ‎<Link>‎ و‎navigate()‎ يفتحوا الصفحة جوّه التطبيق من غير إعادة تحميل.
 */
export function appPath(url: string): string {
  const base = boot.basename
  return base && url.startsWith(`${base}/`) ? url.slice(base.length) : url
}
