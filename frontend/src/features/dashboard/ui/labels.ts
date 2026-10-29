import { useTranslation } from 'react-i18next'

/**
 * تسميات القيم القادمة من الـAPI (حالات، تصنيفات…). الـAPI بيرجّع القيمة (‎published‎)
 * والواجهة هي اللي بتترجمها؛ لو قيمة جديدة مالهاش ترجمة بنعرض تسمية السيرفر.
 */
export function useLabels() {
  const { t } = useTranslation()
  return {
    status: (value: string) => t(`dashboard.status.${value}`, { defaultValue: value }),
    category: (value: string, fallback: string) =>
      t(`dashboard.categories.${value}`, { defaultValue: fallback }),
    source: (value: string, fallback: string) => t(`dashboard.sources.${value}`, { defaultValue: fallback }),
    fontStyle: (value: string, fallback: string) =>
      t(`dashboard.fontStyles.${value}`, { defaultValue: fallback }),
    eventType: (value: string) => t(`dashboard.eventTypes.${value}`, { defaultValue: value }),
  }
}
