/**
 * مقارنة البكسل بالموقع القديم بتشتغل على الصفحات اللي هنا بس (TARGET=react).
 * اضف id الصفحة (من pages.ts) لما تنقلها — كل جلسة في بلوكها عشان مفيش تعارض.
 */
export const PORTED: ReadonlySet<string> = new Set([
  // ---- B1: الموقع العام
  'home',
  'gallery',
  'login',

  // ---- B4: لوحة التحكم
  'dashboard',
  'dashboard-invitations',
  'dashboard-invitation-new',
  'dashboard-templates',
  'dashboard-template-new',
  'dashboard-fonts',
  'dashboard-music',
  'dashboard-intros',
  'dashboard-plans',
  'dashboard-site',
  'dashboard-analytics',
  'dashboard-orders',

  // ---- B2: الضيوف والحضور
  // صفحات اللوحة (dashboard-guests / -guests-qr / -checkin) مش هنا عن قصد: بتتفعّل بعد دمج DashboardLayout بتاع B4.
  'invite-demo1234-pass',
  'invite-demo1234-client',
  'invite-demo1234-venue',

  // ---- B3: عارض الدعوة
  'invite-demo1234',
  'invite-demo1234-guest',
  'template-preview-golden-classic',

  // ---- C: المحرر البصري (شاشة كاملة برّه الغلاف)
  'editor-invitation',
  'editor-template',
])
