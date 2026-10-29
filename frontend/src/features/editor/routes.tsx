import { lazy, Suspense } from 'react'
import type { RouteObject } from 'react-router-dom'

/**
 * مسارات المحرر البصري (Phase C). أبناء ‎/dashboard‎ لكن **برّه** ‎DashboardLayout‎ (محرر ملء الشاشة)،
 * تحت ‎RequireStaff‎ بتاع الأب. chunk لوحده عشان حزمة اللوحة ماتكبرش.
 */
const EditorPage = lazy(() => import('./EditorPage').then((m) => ({ default: m.EditorPage })))

export const editorRoutes: RouteObject[] = [
  {
    path: 'invitations/:id/editor',
    element: (
      <Suspense fallback={null}>
        <EditorPage mode="invitation" />
      </Suspense>
    ),
  },
  {
    path: 'templates/:id/editor',
    element: (
      <Suspense fallback={null}>
        <EditorPage mode="template" />
      </Suspense>
    ),
  },
]
