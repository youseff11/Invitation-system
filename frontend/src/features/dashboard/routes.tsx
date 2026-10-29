import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

/**
 * صاحب الملف: B4 (لوحة التحكم).
 * أبناء ‎/dashboard‎ (تحت DashboardLayout): الدعوات، القوالب، الطلبات، الباقات،
 * الخطوط، الموسيقى، الافتتاحيات، الإعدادات، الإحصائيات…
 * صفحات الضيوف والـcheck-in بتاعة B2 في ‎features/guests/routes.tsx‎.
 * الرئيسية (‎/dashboard‎ نفسه) بتتعرض من ‎pages/DashboardPage.tsx‎ اللي بتعيد تصدير ‎HomePage‎.
 * كل صفحة في chunk لوحدها عشان زائر الموقع العام مايحمّلش كود اللوحة.
 */
const InvitationsPage = lazy(() => import('./pages/InvitationsPage').then((m) => ({ default: m.InvitationsPage })))
const InvitationNewPage = lazy(() =>
  import('./pages/InvitationNewPage').then((m) => ({ default: m.InvitationNewPage })),
)
const TemplatesPage = lazy(() => import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })))
const TemplateNewPage = lazy(() => import('./pages/TemplateNewPage').then((m) => ({ default: m.TemplateNewPage })))
const FontsPage = lazy(() => import('./pages/FontsPage').then((m) => ({ default: m.FontsPage })))
const MusicPage = lazy(() => import('./pages/MusicPage').then((m) => ({ default: m.MusicPage })))
const IntrosPage = lazy(() => import('./pages/IntrosPage').then((m) => ({ default: m.IntrosPage })))
const VideosPage = lazy(() => import('./pages/VideosPage').then((m) => ({ default: m.VideosPage })))
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })))
const PlansPage = lazy(() => import('./pages/PlansPage').then((m) => ({ default: m.PlansPage })))
const SitePage = lazy(() => import('./pages/SitePage').then((m) => ({ default: m.SitePage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))

export const dashboardRoutes: RouteObject[] = [
  { path: 'invitations', element: <InvitationsPage /> },
  { path: 'invitations/new', element: <InvitationNewPage /> },
  { path: 'templates', element: <TemplatesPage /> },
  { path: 'templates/new', element: <TemplateNewPage /> },
  { path: 'fonts', element: <FontsPage /> },
  { path: 'music', element: <MusicPage /> },
  { path: 'videos', element: <VideosPage /> },
  { path: 'intros', element: <IntrosPage /> },
  { path: 'orders', element: <OrdersPage /> },
  { path: 'plans', element: <PlansPage /> },
  { path: 'site', element: <SitePage /> },
  { path: 'analytics', element: <AnalyticsPage /> },
]
