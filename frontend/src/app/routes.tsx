import type { RouteObject } from 'react-router-dom'

import { Layout } from '@/components/Layout'
import { RequireStaff } from '@/components/RequireStaff'
import { DashboardLayout } from '@/features/dashboard/DashboardLayout'
import { dashboardRoutes } from '@/features/dashboard/routes'
import { dataAdminRoutes } from '@/features/dataadmin/routes'
import { editorRoutes } from '@/features/editor/routes'
import { guestDashboardRoutes, guestPublicRoutes } from '@/features/guests/routes'
import { inviteRoutes } from '@/features/invite/routes'
import { publicRoutes } from '@/features/public/routes'
import { DashboardPage } from '@/pages/DashboardPage'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/**
 * خريطة المسارات — المسارات نسبية لـbasename (‎/app‎ أثناء الترحيل، وفاضي بعد
 * التحويل النهائي). الملف ده بيجمّع بس: كل جلسة بتكتب مساراتها في ملف ميزتها
 * (‎features/<area>/routes.tsx‎) ومابتعدّلش هنا.
 */
export const routes: RouteObject[] = [
  // الموقع العام: جوّه ترويسة الموقع
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      ...publicRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // لوحة التحكم: فريق العمل بس، وبغلافها الخاص
  {
    path: 'dashboard',
    element: <RequireStaff />,
    children: [
      {
        element: <DashboardLayout />,
        children: [{ index: true, element: <DashboardPage /> }, ...dashboardRoutes, ...dataAdminRoutes, ...guestDashboardRoutes],
      },
      // المحرر البصري: ملء الشاشة من غير غلاف اللوحة
      ...editorRoutes,
    ],
  },
  // صفحات مستقلة من غير أي ترويسة: الدعوة، القاعة، متابعة العميل، التصريح
  ...inviteRoutes,
  ...guestPublicRoutes,
]
