import type { RouteObject } from 'react-router-dom'

/**
 * صاحب الملف: B2 (الضيوف والحضور).
 *
 * guestDashboardRoutes: أبناء ‎/dashboard‎ (جوّه DashboardLayout بتاع B4):
 *   ‎invitations/:id/guests‎، ‎guests/qr-sheet‎، ‎checkin‎.
 * guestPublicRoutes: صفحات مستقلة من غير ترويسة الموقع:
 *   ‎i/:slug/venue/:token‎، ‎i/:slug/client/:token‎، ‎i/:slug/g/:token/pass‎.
 *
 * كل صفحة بتتحمّل لوحدها (lazy) فمفيش حاجة من الميزة دي بتتحمّل مع باقي الموقع.
 */
export const guestDashboardRoutes: RouteObject[] = [
  {
    path: 'invitations/:id/guests',
    lazy: async () => ({ Component: (await import('./components/GuestsPage')).GuestsPage }),
  },
  {
    path: 'invitations/:id/guests/qr-sheet',
    lazy: async () => ({ Component: (await import('./components/QrSheetPage')).QrSheetPage }),
  },
  {
    path: 'invitations/:id/checkin',
    lazy: async () => ({ Component: (await import('./components/CheckinPage')).CheckinPage }),
  },
]

export const guestPublicRoutes: RouteObject[] = [
  {
    path: 'i/:slug/venue/:token',
    lazy: async () => ({ Component: (await import('./components/VenuePage')).VenuePage }),
  },
  {
    path: 'i/:slug/client/:token',
    lazy: async () => ({ Component: (await import('./components/ClientFollowupPage')).ClientFollowupPage }),
  },
  {
    path: 'i/:slug/g/:token/pass',
    lazy: async () => ({ Component: (await import('./components/GuestPassPage')).GuestPassPage }),
  },
]
