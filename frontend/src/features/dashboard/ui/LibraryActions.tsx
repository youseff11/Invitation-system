import { useTranslation } from 'react-i18next'

import type { LibraryKind } from '../api'
import { useConfirm } from './ConfirmDialog'
import { useToast } from './Toast'

interface Row {
  id: number
  name: string
  isActive: boolean
}

interface Mutation<TData> {
  mutate: (
    id: number,
    options: { onSuccess?: (data: TData) => void; onError?: (error: unknown) => void },
  ) => void
}

interface LibraryActionsProps {
  kind: LibraryKind
  row: Row
  toggle: Mutation<unknown>
  remove: Mutation<unknown>
  /** المسافة بين الزرارين (الخطوط ٥px، الباقي ٦px — زي القديم). */
  gap?: number
}

/** زرارين «إخفاء/إظهار» و«حذف» في آخر صف مكتبات الخطوط والموسيقى والافتتاحيات. */
export function LibraryActions({ kind, row, toggle, remove, gap = 6 }: LibraryActionsProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()

  function onToggle() {
    toggle.mutate(row.id, {
      // الحالة بعد التبديل عكس الحالية
      onSuccess: () =>
        toast.success(t(`dashboard.${kind}.${row.isActive ? 'hiddenDone' : 'shownDone'}`, { name: row.name })),
      onError: toast.fail,
    })
  }

  async function onDelete() {
    const message = t(`dashboard.${kind}.confirmDelete`, { name: row.name })
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    remove.mutate(row.id, {
      onSuccess: () => toast.success(t(`dashboard.${kind}.deleted`, { name: row.name })),
      onError: toast.fail,
    })
  }

  return (
    <div className="toolbar" style={{ margin: 0, gap }}>
      <button className="btn btn--ghost btn--sm" type="button" onClick={onToggle}>
        {row.isActive ? t('dashboard.common.hide') : t('dashboard.common.show')}
      </button>
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => void onDelete()}>
        {t('dashboard.common.delete')}
      </button>
    </div>
  )
}
