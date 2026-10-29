import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useMe } from '@/api/hooks'

/** حارس مسارات لوحة التحكم: لازم مستخدم مسجّل من فريق العمل. */
export function RequireStaff() {
  const { data: user, isPending } = useMe()
  const location = useLocation()

  if (isPending) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (!user.isStaff) return <Navigate to="/" replace />
  return <Outlet />
}
