import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'

/** رسالة بسيطة لصفحات الرموز: الرابط مش صالح (404) أو خطأ تاني. */
export function InvalidLink({ error, messageKey }: { error: unknown; messageKey: string }) {
  const { t } = useTranslation()
  const notFound = error instanceof ApiError && error.status === 404
  return <p className="gw-invalid">{notFound ? t(messageKey) : t('errors.generic')}</p>
}
