import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { errorText, useToast } from '@/features/dashboard/ui/Toast'

import { deleteObjects, previewDelete } from './api'
import type { DeletePreview } from './types'

/** تأكيد الحذف زي الأدمن: بيعرض اللي هيتحذف معاه، ويرفض لو فيه سجلات محمية. */
export function DeleteDialog({
  modelKey,
  ids,
  onClose,
  onDone,
}: {
  modelKey: string
  ids: number[]
  onClose: () => void
  onDone: (deleted: number) => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let alive = true
    previewDelete(modelKey, ids)
      .then((data) => alive && setPreview(data))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [modelKey, ids])

  useEffect(() => {
    cancel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const blocked = !!preview && (preview.protected.length > 0 || preview.permsNeeded.length > 0)

  async function confirm() {
    setBusy(true)
    try {
      const done = await deleteObjects(modelKey, ids)
      onDone(done.deleted)
    } catch (error) {
      toast.error(errorText(error, t('dataadmin.deleteFailed'), t('dataadmin.network')))
      setBusy(false)
    }
  }

  return (
    <div className="dash-dialog-veil" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="dash-dialog da-delete" role="alertdialog" aria-modal="true" aria-label={t('dataadmin.deleteTitle')}>
        <h2>{t('dataadmin.deleteTitle')}</h2>
        {failed && <p className="da-bad">{t('dataadmin.previewFailed')}</p>}
        {!preview && !failed && <p className="muted">{t('dataadmin.loading')}</p>}
        {preview && (
          <>
            <p>{t('dataadmin.deleteAsk', { count: ids.length })}</p>
            {blocked ? (
              <div className="da-bad">
                <p>{t('dataadmin.protected')}</p>
                <ul>
                  {[...preview.protected, ...preview.permsNeeded].map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <ul className="da-tree">
                  {preview.items.map((item, index) => (
                    <li key={index} style={{ paddingInlineStart: item.depth * 16 }}>
                      {item.text}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  {Object.entries(preview.counts)
                    .map(([name, count]) => `${name}: ${count}`)
                    .join(' · ')}
                </p>
              </>
            )}
          </>
        )}
        <div className="dash-dialog-actions">
          <button ref={cancel} type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onClose}>
            {t('dashboard.common.cancel')}
          </button>
          <button type="button" className="btn btn--ghost btn--danger btn--sm" disabled={!preview || blocked || busy} onClick={() => void confirm()}>
            {t('dataadmin.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
