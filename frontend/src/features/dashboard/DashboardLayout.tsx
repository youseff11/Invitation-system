import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'

import { DashboardHeader } from './DashboardHeader'
import './styles/dashboard.css'
import { ConfirmProvider } from './ui/ConfirmDialog'
import { ToastProvider } from './ui/Toast'

/**
 * صاحب الملف: B4. هيكل لوحة التحكم: الترويسة العائمة (نفس ‎partials/nav.html‎ بـ‎dash=True‎)
 * + ‎<main class="dash-main">‎ + تنبيهات (toasts) وحوار التأكيد. باقي الجلسات بتكتب
 * صفحاتها كأبناء ‎<Outlet />‎ ومابتعتمدش على شكل الغلاف.
 *
 * ‎.dash-root‎ هو النطاق اللي كل CSS اللوحة محصور جواه (شوف ‎styles/dashboard.css‎).
 */
export function DashboardLayout() {
  const { t } = useTranslation()
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="dash-root">
          <a className="skip-link" href="#main">
            {t('dashboard.nav.skip')}
          </a>
          <DashboardHeader />
          <main className="dash-main" id="main">
            <div className="wrap">
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  )
}
