import { lazy, Suspense } from 'react'
import type { RouteObject } from 'react-router-dom'

/**
 * صاحب الملف: B3 (عارض الدعوة).
 * صفحات الدعوة المستقلة (من غير ترويسة الموقع):
 *   ‎i/:slug‎، ‎i/:slug/g/:token‎ و وصفحة كلمة السر — لسه بتتقدّم من entry الدعوة الخفيف
 *   (‎invite-main.tsx‎) لأن الضيف مش محتاج التطبيق كله.
 * معاينة القالب (‎templates/:slug/preview‎) ليها route هنا كمان عشان الضغطة من جوّه
 * التطبيق تفتحها من غير reload؛ والفتح المباشر لنفس الرابط بيتقدّم من السيرفر.
 * ‎i/:slug/venue|client|g/:token/pass‎ بتاعة B2 — متكتبش فوقها.
 */
const TemplatePreviewPage = lazy(() => import('./TemplatePreviewPage'))

export const inviteRoutes: RouteObject[] = [
  {
    path: 'templates/:slug/preview',
    element: (
      <Suspense fallback={null}>
        <TemplatePreviewPage />
      </Suspense>
    ),
  },
]
