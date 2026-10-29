import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useSite } from '@/api/hooks'
import type { Lang } from '@/api/types'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/** عنوان التبويب «الصفحة — اسم الموقع» زي ‎{% block title %}‎ في القوالب القديمة. */
export function usePageTitle(title: string) {
  const { i18n } = useTranslation()
  const { data: site } = useSite()
  const siteName = site?.name[(i18n.language as Lang) ?? 'ar'] ?? ''
  useDocumentTitle(siteName ? `${title} — ${siteName}` : title)
}

interface PageHeadProps {
  title: string
  /** سطر شرح تحت العنوان (صفحة الخطوط). */
  subtitle?: string
  /** أزرار الجنب (بتتحط يمين/شمال حسب الاتجاه زي ‎.dash-head‎). */
  children?: ReactNode
}

export function PageHead({ title, subtitle, children }: PageHeadProps) {
  return (
    <div className="dash-head">
      {subtitle ? (
        <div>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
      ) : (
        <h1>{title}</h1>
      )}
      {children}
    </div>
  )
}

/** حبّة الحالة (‎.pill--published‎ …) — اللون من الـCSS حسب القيمة. */
export function Pill({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={kind ? `pill pill--${kind}` : 'pill'}>{children}</span>
}
