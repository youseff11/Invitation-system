import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { EditorSchema } from '../types'
import { FieldGroups, useOpenGroups } from './FieldGroups'

/** تبويب التصميم: ألوان وخطوط وشكل الدعوة كلها (‎schema.theme_fields‎) → ‎doc.theme‎. */
export function ThemePanel({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const theme = useEditor((s) => s.doc.theme)
  const setTheme = useEditor((s) => s.setTheme)
  const groups = useOpenGroups()

  return (
    <>
      <p className="ed-kicker">{t('editorSettings.theme.kicker')}</p>
      <p className="ed-hint">{t('editorSettings.theme.hint')}</p>
      <FieldGroups
        specs={schema.theme_fields}
        get={(spec) => theme[spec.key]}
        set={(spec, value) => setTheme(spec.key, value)}
        open={groups.open}
        onToggle={groups.onToggle}
      />
    </>
  )
}
