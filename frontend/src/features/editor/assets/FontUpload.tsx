import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { FontRow } from '../types'
import { useEditorUi } from '../ui'
import { uploadFont } from './api'
import { errorText } from './errors'

/**
 * «رفع خط جديد» جنب قايمة الخط: بيرفع الملف لمكتبة الخطوط (نفس ‎CustomFontForm‎ بتاع لوحة الخطوط)
 * ويضيفه لـ‎store.lib.fonts‎ فيظهر في كل حقول الخط، وبيتطبق على الحقل اللي رفعت منه.
 */
export function FontUpload({ onUploaded }: { onUploaded: (font: FontRow) => void }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const addFont = useEditor((s) => s.addFont)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { font } = await uploadFont(file)
      addFont(font)
      onUploaded(font)
      ui.toast(t('editorAssets.font.added'), 'ok')
    } catch (error) {
      ui.toast(errorText(error, t, 'editorAssets.errors.font'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ed-font-tools ed-font-tools--compact">
      <button type="button" className="ed-btn ed-btn--sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('editorAssets.font.uploading') : t('editorAssets.font.upload')}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="font-file-input"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
    </div>
  )
}
