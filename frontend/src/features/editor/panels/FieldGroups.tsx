import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldRenderer } from '../fields'
import { gearFor, useStyleScope } from '../fields/textStyle'
import type { FieldSpec } from '../types'

export interface Group {
  name: string
  specs: FieldSpec[]
  open: boolean
}

/** يجمّع حقول السكيما في مجموعات بترتيب أول ظهور، ويتخطّى المخفي من المحرر. */
export function groupFields(specs: FieldSpec[], fallbackName: string): Group[] {
  const groups: Group[] = []
  for (const spec of specs) {
    if (spec.editor_hidden) continue
    const name = spec.group || fallbackName
    let group = groups.find((g) => g.name === name)
    if (!group) groups.push((group = { name, specs: [], open: false }))
    group.specs.push(spec)
    if (spec.group_open) group.open = true
  }
  return groups
}

interface Props {
  specs: FieldSpec[]
  get: (spec: FieldSpec) => unknown
  set: (spec: FieldSpec, value: unknown) => void
  /** مجموعات مفتوحة بالاسم — بتفضل زي ما هي لما القسم يتبدّل (زي القديم) */
  open: Record<string, boolean>
  onToggle: (name: string, open: boolean) => void
  /** أول مجموعة بتتفتح لوحدها لو المستخدم لسه ماختارش */
  openFirst?: boolean
  /** مجموعات مش هتتعرض خالص (بالاسم) */
  hide?: string[]
  /** مجموعات بتتفتح لوحدها لو المستخدم لسه ماقفلهاش */
  defaultOpen?: string[]
}

/**
 * مجموعات الحقول القابلة للطي (‎<details>‎) — مشتركة بين خصائص القسم والتصميم والإعدادات.
 * حقول التنسيق المخفية (‎style_of‎) بتظهر كترس جنب النص اللي بتنسّقه.
 */
export function FieldGroups({ specs, get, set, open, onToggle, openFirst = true, hide = [], defaultOpen = [] }: Props) {
  const { t } = useTranslation()
  const groups = groupFields(specs, t('editor.inspector.defaultGroup')).filter((g) => !hide.includes(g.name))
  const scope = useStyleScope(specs, get, set)
  return (
    <>
      {groups.map((group, index) => (
        <details
          key={group.name}
          className={`ed-group${group.specs.some((s) => s.group_open) ? ' ed-group--accent' : ''}`}
          open={open[group.name] ?? (group.open || defaultOpen.includes(group.name) || (openFirst && index === 0))}
          onToggle={(e) => onToggle(group.name, e.currentTarget.open)}
        >
          <summary>
            <span>{group.name}</span>
          </summary>
          <div className="ed-group-body">
            {group.specs.map((spec) => (
              <FieldRenderer key={spec.key} spec={spec} value={get(spec)} onChange={(v) => set(spec, v)} gear={gearFor(spec, scope)} />
            ))}
          </div>
        </details>
      ))}
    </>
  )
}

/** حالة فتح/قفل المجموعات بالاسم. */
export function useOpenGroups() {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return { open, onToggle: (name: string, value: boolean) => setOpen((o) => (o[name] === value ? o : { ...o, [name]: value })) }
}
