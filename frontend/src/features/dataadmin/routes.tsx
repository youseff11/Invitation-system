import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

/** إدارة البيانات (بديل ‎/admin/‎) — أبناء ‎/dashboard/data‎ تحت غلاف اللوحة. */
const DataHomePage = lazy(() => import('./DataHomePage').then((m) => ({ default: m.DataHomePage })))
const DataListPage = lazy(() => import('./DataListPage').then((m) => ({ default: m.DataListPage })))
const DataFormPage = lazy(() => import('./DataFormPage').then((m) => ({ default: m.DataFormPage })))

export const dataAdminRoutes: RouteObject[] = [
  { path: 'data', element: <DataHomePage /> },
  { path: 'data/:model', element: <DataListPage /> },
  { path: 'data/:model/new', element: <DataFormPage /> },
  { path: 'data/:model/:id', element: <DataFormPage /> },
]
