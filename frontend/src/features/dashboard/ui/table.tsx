import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface TableProps {
  /** عناوين الأعمدة — ‎null‎ لعمود الإجراءات اللي من غير عنوان. */
  head: (ReactNode | null)[]
  /** ‎true‎: الصفوف بتبقى كروت على الموبايل (والخانات لازم ليها ‎data-label‎). */
  cards?: boolean | 'lg'
  className?: string
  style?: CSSProperties
  /** رسالة «مفيش نتايج» — بتظهر لو ‎rows‎ فاضية. */
  empty: ReactNode
  isEmpty: boolean
  children: ReactNode
}

/** ‎<div class="table-wrap">‎ + جدول + صف فاضي — شكل جداول اللوحة كلها. */
export function Table({ head, cards, className, style, empty, isEmpty, children }: TableProps) {
  const classes = ['table-wrap']
  if (cards) classes.push('table-cards')
  if (cards === 'lg') classes.push('table-cards--lg')
  if (className) classes.push(className)
  return (
    <div className={classes.join(' ')} style={style}>
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} className={index === head.length - 1 && cards ? 'th-actions' : undefined}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {isEmpty && (
            <tr className={cards ? 'is-empty' : undefined}>
              <td colSpan={head.length} className="empty">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** حالة تحميل/خطأ لصفحة قبل ما بياناتها توصل. */
export function QueryState({ loading, error }: { loading: boolean; error: boolean }) {
  const { t } = useTranslation()
  if (error) return <p className="empty">{t('dashboard.common.loadError')}</p>
  if (loading) return <p className="empty" aria-busy="true">{t('dashboard.common.loading')}</p>
  return null
}
