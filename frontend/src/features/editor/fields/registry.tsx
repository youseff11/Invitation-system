import type { ComponentType, ReactNode } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { FieldSpec, FieldType } from '../types'

export interface FieldProps {
  spec: FieldSpec
  value: unknown
  onChange: (value: unknown) => void
  /** ‎id‎ للعنصر الرئيسي عشان الـ‎label‎ يشاور عليه */
  id: string
}

const registry = new Map<FieldType, ComponentType<FieldProps>>()

/**
 * سجل مكوّنات الحقول — نقطة التوسعة: كل نوع حقل في السكيما (‎FieldSpec.type‎) ليه مكوّن.
 * الخطوات الجاية (الأصول، الخطوط، التنسيق…) بتسجّل مكوّناتها هنا من غير ما تلمس الـinspector.
 */
export function registerField(type: FieldType, component: ComponentType<FieldProps>) {
  registry.set(type, component)
}

export const getField = (type: FieldType) => registry.get(type)

/**
 * غلاف الحقل: العنوان، تنبيه «خارج الباقة»، والمساعدة — والجسم من السجل حسب النوع.
 * ‎gear‎: ترس تنسيق النص (‎textStyle.tsx‎) — بيتحط جنب الجسم في صف واحد ولوحته تحته.
 */
export function FieldRenderer({ spec, value, onChange, gear }: Omit<FieldProps, 'id'> & { gear?: ReactNode }) {
  const { t } = useTranslation()
  const id = useId()
  const gated = useEditor((s) => !!spec.feature && !s.features.includes(spec.feature))
  const Body = registry.get(spec.type) ?? registry.get('text')
  if (!Body) return null

  const field = <Body spec={spec} value={value} onChange={onChange} id={id} />
  const body = gear ? (
    <div className="ed-text-control-row">
      {field}
      {gear}
    </div>
  ) : (
    field
  )
  return (
    <div className="ed-field" data-field-key={spec.key}>
      {spec.type !== 'toggle' && (
        <label htmlFor={id}>
          <span>{spec.label}</span>
          {spec.type === 'range' && (
            <b>
              {String(value ?? '')}
              {spec.unit ?? ''}
            </b>
          )}
          {gated && <b className="ed-gate-tag">{t('editor.inspector.outsidePlan')}</b>}
        </label>
      )}
      {body}
      {spec.help && <small>{spec.help}</small>}
    </div>
  )
}
