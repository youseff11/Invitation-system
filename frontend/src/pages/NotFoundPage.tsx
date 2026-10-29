import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function NotFoundPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('notFound.title'))
  return (
    <div className="page wrap" style={{ textAlign: 'center' }}>
      <h1>{t('notFound.title')}</h1>
      <Link to="/" className="btn btn--ghost">
        {t('notFound.back')}
      </Link>
    </div>
  )
}
