import type { QueryClient } from '@tanstack/react-query'

import { catalogQuery } from '../dataadmin/api'
import { dashQueries } from './api'

/**
 * جلب مسبق لصفحات اللوحة: الصفحات lazy (chunk لكل صفحة) وبياناتها بتبدأ بعد ما الـchunk يوصل،
 * فالضغطة الأولى كانت بتعدّي بـ«جارٍ التحميل…». هنا بنجيب الـchunk (وبيانات الصفحة بنفس مفتاح الـhook)
 * قبل الضغط: لما المؤشر أو اللمس يوصل للرابط، وكل الـchunks في وقت فراغ المتصفح بعد فتح اللوحة.
 */
interface Target {
  chunk: () => Promise<unknown>
  data?: (client: QueryClient) => Promise<unknown>
}

const library = (kind: 'fonts' | 'music' | 'intros' | 'videos', chunk: () => Promise<unknown>): Target => ({
  chunk,
  data: (client) => client.prefetchQuery(dashQueries.library(kind)),
})

const TARGETS: Record<string, Target> = {
  '/dashboard': { chunk: () => import('./pages/HomePage'), data: (c) => c.prefetchQuery(dashQueries.overview()) },
  '/dashboard/invitations': {
    chunk: () => import('./pages/InvitationsPage'),
    data: (c) => c.prefetchQuery(dashQueries.invitations({ q: '', status: '', template: '' })),
  },
  '/dashboard/templates': { chunk: () => import('./pages/TemplatesPage'), data: (c) => c.prefetchQuery(dashQueries.templates()) },
  '/dashboard/orders': { chunk: () => import('./pages/OrdersPage'), data: (c) => c.prefetchQuery(dashQueries.orders('')) },
  '/dashboard/plans': { chunk: () => import('./pages/PlansPage'), data: (c) => c.prefetchQuery(dashQueries.plans()) },
  '/dashboard/site': { chunk: () => import('./pages/SitePage'), data: (c) => c.prefetchQuery(dashQueries.site()) },
  '/dashboard/analytics': { chunk: () => import('./pages/AnalyticsPage'), data: (c) => c.prefetchQuery(dashQueries.analytics()) },
  '/dashboard/fonts': library('fonts', () => import('./pages/FontsPage')),
  '/dashboard/music': library('music', () => import('./pages/MusicPage')),
  '/dashboard/intros': library('intros', () => import('./pages/IntrosPage')),
  '/dashboard/videos': library('videos', () => import('./pages/VideosPage')),
  '/dashboard/data': { chunk: () => import('../dataadmin/DataHomePage'), data: (c) => c.prefetchQuery(catalogQuery()) },
}

const requested = new Set<string>()

/** يسخّن صفحة (chunk + بيانات) — مرة واحدة لكل مسار، وأي فشل بيتجاهل (الضغطة الفعلية هتجرّب تاني). */
export function prefetchDashboard(client: QueryClient, pathname: string, withData = true) {
  const key = `${pathname}|${withData}`
  const target = TARGETS[pathname.replace(/\/$/, '')]
  if (!target || requested.has(key)) return
  requested.add(key)
  void target.chunk().catch(() => requested.delete(key))
  if (withData && target.data) void target.data(client).catch(() => requested.delete(key))
}

/** كل الـchunks (من غير بيانات) في وقت الفراغ. */
export function prefetchAllChunks(client: QueryClient) {
  const run = () => Object.keys(TARGETS).forEach((path) => prefetchDashboard(client, path, false))
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  if (idle) idle(run)
  else setTimeout(run, 1500)
}
