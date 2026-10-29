import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { EditorSchema } from '../types'
import { FieldGroups, useOpenGroups } from './FieldGroups'

/**
 * تبويب الإعدادات: الموسيقى والافتتاحية والتمرير والمشاركة (‎schema.settings_fields‎) → ‎doc.settings‎.
 * اختيار ملف الموسيقى/الفيديو من المكتبة بيجي بتسجيل حقل ‎media‎ بديل (مكتبة الأصول).
 */
export function SettingsPanel({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const settings = useEditor((s) => s.doc.settings)
  const setSetting = useEditor((s) => s.setSetting)
  const groups = useOpenGroups()

  return (
    <>
      <p className="ed-kicker">{t('editorSettings.settings.kicker')}</p>
      <p className="ed-hint">{t('editorSettings.settings.hint')}</p>
      <FieldGroups
        specs={schema.settings_fields}
        get={(spec) => settings[spec.key]}
        set={(spec, value) => setSetting(spec.key, value)}
        open={groups.open}
        onToggle={groups.onToggle}
      />
    </>
  )
}
