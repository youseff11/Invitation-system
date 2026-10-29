/**
 * مسارات الضيوف.
 *
 * الروابط اللي بتتشارك (بتتنسخ أو بتتبعت) بتفضل على المسارات الأصلية
 * ‎/i/…‎ من غير بادئة ‎/app‎: بتشتغل دلوقتي على الموقع القديم وبعد التحويل
 * النهائي على React، وهي نفس اللي مشفّر في رموز QR. التنقل جوّه التطبيق بيتم
 * بـ‎<Link>‎ (الـrouter بيضيف الـbasename).
 */

export const personalPath = (slug: string, token: string) => `/i/${slug}/g/${token}/`
export const venuePath = (slug: string, token: string) => `/i/${slug}/venue/${token}/`
export const clientPath = (slug: string, token: string) => `/i/${slug}/client/${token}/`
export const passPath = (slug: string, token: string) => `/i/${slug}/g/${token}/pass/`

/** صور الـQR بيقدّمها Django زي ما هي. */
export const qrSvgUrl = (slug: string, token: string) => `/i/${slug}/g/${token}/qr.svg`
export const qrPngUrl = (slug: string, token: string) => `/i/${slug}/g/${token}/qr.png`

/** الرابط الكامل للنسخ والمشاركة. */
export const absoluteUrl = (path: string) => `${window.location.origin}${path}`

/** تنزيلات من الـAPI (GET عادي — الكوكيز بتتبعت لوحدها). */
export const exportUrl = (invitationId: number) => `/api/v1/invitations/${invitationId}/guests/export.xlsx`
export const SAMPLE_CSV_URL = '/api/v1/guests/sample.csv'

/** المحرر البصري (شاشة كاملة برّه غلاف اللوحة) — مسار الـrouter، يتفتح بـ‎<Link>‎. */
export const editorPath = (invitationId: number) => `/dashboard/invitations/${invitationId}/editor`

export const guestsRoute = (invitationId: number | string) => `/dashboard/invitations/${invitationId}/guests`
export const qrSheetRoute = (invitationId: number | string) => `/dashboard/invitations/${invitationId}/guests/qr-sheet`
export const checkinRoute = (invitationId: number | string) => `/dashboard/invitations/${invitationId}/checkin`

/** واتساب: اسم الضيف ورابطه (نفس صيغة الصفحة القديمة). */
export function whatsappGuestUrl(name: string, link: string) {
  return `https://wa.me/?text=${encodeURIComponent(name)}%2C%20${link}`
}
