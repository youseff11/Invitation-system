/** تنضيف رابط الدعوة قبل ما يتبعت — نفس ‎cleanSlug‎ في المحرر القديم (والسيرفر بيعيد التنضيف ويتحقق). */
export function cleanSlug(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** أقل طول مقبول للرابط (بيطابق ‎clean_slug‎ في ‎InvitationSettingsForm‎) */
export const SLUG_MIN = 3

/** ‎نسخ نص للحافظة؛ لو المتصفح منع ‎navigator.clipboard‎ بنجرّب ‎execCommand‎. ‎true‎ لو نجح. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* بنكمّل بالطريقة القديمة */
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
