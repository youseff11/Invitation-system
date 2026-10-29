import { useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'
import { useImportGuests } from '../api'
import { downloadFile } from '../download'
import { SAMPLE_CSV_URL } from '../links'
import type { Flash } from './flash'

interface Props {
  invitationId: string
  onResult: (messages: Flash[]) => void
}

/** استيراد قائمة الضيوف من CSV أو Excel، مع ملخص النتيجة وملف نموذجي. */
export function ImportCard({ invitationId, onResult }: Props) {
  const { t } = useTranslation()
  const importer = useImportGuests(invitationId)
  const input = useRef<HTMLInputElement>(null)

  function downloadSample() {
    downloadFile(SAMPLE_CSV_URL, 'guests-sample.csv').catch((error: unknown) =>
      onResult([
        {
          kind: 'error',
          text: error instanceof ApiError ? error.message || t('errors.generic') : t('errors.network'),
        },
      ]),
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const file = input.current?.files?.[0]
    if (!file) return
    importer.mutate(file, {
      onSuccess: (report) => {
        const messages: Flash[] = []
        if (report.total) {
          messages.push({
            kind: 'success',
            text: t('guests.import.done', {
              created: report.created,
              updated: report.updated,
              skipped: report.skipped,
            }),
          })
        }
        for (const error of report.errors) messages.push({ kind: 'error', text: error })
        if (!report.total && !report.errors.length) {
          messages.push({ kind: 'error', text: t('guests.import.noRows') })
        }
        onResult(messages)
        form.reset()
      },
      onError: (error) => {
        onResult([
          {
            kind: 'error',
            text: error instanceof ApiError ? error.message || t('errors.generic') : t('errors.network'),
          },
        ])
      },
    })
  }

  return (
    <div className="gw-card gw-card--spaced">
      <h2>{t('guests.import.title')}</h2>
      <p className="muted">{t('guests.import.help')}</p>
      <form className="toolbar" onSubmit={submit}>
        <input
          ref={input}
          type="file"
          name="csv_file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
        <button className="btn btn--gold btn--sm" type="submit" disabled={importer.isPending}>
          {t('guests.import.submit')}
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={downloadSample}>
          {t('guests.import.sample')}
        </button>
      </form>
    </div>
  )
}
