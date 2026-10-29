import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { EditorShell } from './EditorShell'
import { useBootstrap, useSchema } from './hooks'
import { resetEditor, useEditor } from './store'
import type { EditorMode } from './types'
import { EditorUiProvider } from './ui'

/** صفحة المحرر (ملء الشاشة، من غير غلاف اللوحة): بتجيب السكيما والمستند وتسلّمهم للـstore. */
export function EditorPage({ mode }: { mode: EditorMode }) {
  const { t } = useTranslation()
  const id = Number(useParams().id)
  const schema = useSchema()
  const boot = useBootstrap(mode, id)
  const load = useEditor((s) => s.load)
  const ready = useEditor((s) => s.loaded && s.mode === mode && s.id === id)

  useEffect(() => {
    if (boot.data) load(boot.data)
  }, [boot.data, load])
  useEffect(() => () => resetEditor(), [])

  const error = boot.error ?? schema.error
  if (error || !Number.isInteger(id)) {
    return (
      <div className="ed-root ed-boot">
        <p>{t('editor.loadFailed')}</p>
        <button
          type="button"
          className="ed-btn"
          onClick={() => {
            void boot.refetch()
            void schema.refetch()
          }}
        >
          {t('editor.retry')}
        </button>
      </div>
    )
  }
  if (!schema.data || !ready) {
    return (
      <div className="ed-root ed-boot">
        <p>{t('editor.loading')}</p>
      </div>
    )
  }
  return (
    <EditorUiProvider>
      <EditorShell schema={schema.data} />
    </EditorUiProvider>
  )
}
