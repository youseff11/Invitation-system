import type { RouteObject } from 'react-router-dom'

import { GalleryPage } from './GalleryPage'

/**
 * صاحب الملف: B1 (الموقع العام).
 * مسارات الموقع العام اللي بتتعرض جوّه شكل الموقع (الترويسة): معرض القوالب…
 * المسارات نسبية لـbasename. الرئيسية والدخول في app/routes.tsx (بيستوردوا من
 * ‎pages/HomePage.tsx‎ و‎pages/LoginPage.tsx‎ اللي بتشاور هنا).
 * معاينة القالب (‎templates/:slug/preview‎) صفحة مستقلة بتاعة B3.
 * ميزتك كلها (صفحات، hooks، types، CSS) جوّه ‎features/public/‎.
 */
export const publicRoutes: RouteObject[] = [{ path: 'templates', element: <GalleryPage /> }]
