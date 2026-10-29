import type { CSSProperties, ReactNode } from 'react'

import { useInvite } from '../context'
import { Raw } from '../Raw'
import { parseStyle } from '../style'
import { DividerOrnament } from '../svg'
import type { BlockData } from '../types'

interface FrameProps {
  block: BlockData
  children: ReactNode
  /** إضافات فوق متغيّرات القسم (ستايل inline) */
  style?: CSSProperties
  /** مكان الزخرفة العلوية/السفلية؛ ‎false‎ = القالب مابيرسمهاش (فاصل، قسم مستورد…) */
  ornaments?: boolean
  innerClass?: string
}

/** عناصر «فوق القسم» و«كود متقدّم»: بيتحقنوا آخر حاجة في القسم (زي ‎render_document‎). */
export function Tail({ block }: { block: BlockData }) {
  // كل واحد في ‎Raw‎ لوحده: تغيير عنصر فوق القسم (إضافة/سحب) ماينفعش يعيد بناء صندوق الكود وسكربته (وإلا الأنيميشن بتبدأ من الأول)
  return (
    <>
      <Raw html={block.overlays} />
      <Raw html={block.code} />
    </>
  )
}

/** تنبيه المحرر: القسم مفعّل في المستند بس خارج باقة العميل (الحمولة بتبعت ‎gated‎ للمحرر بس). */
export function Gate({ block }: { block: BlockData }) {
  const { t } = useInvite()
  return block.gated ? <div className="lb-gate">{t('editor.gate')}</div> : null
}

/**
 * هيكل القسم العادي (‎<section>‎ ثم ‎.lb-inner‎) — نفس اللي بتكتبه قوالب
 * ‎templates/blocks/*.html‎. ‎attrs‎ جاهزة من السيرفر (الكلاسات والمتغيّرات).
 */
export function Frame({ block, children, style, ornaments = true, innerClass = 'lb-inner' }: FrameProps) {
  const { attrs } = block
  return (
    <section
      id={attrs.id}
      className={attrs.className}
      style={{ ...parseStyle(attrs.style), ...style }}
      data-block={block.id}
      data-block-type={block.type}
    >
      {ornaments && <DividerOrnament variant={block.dividerTop} slot="ornament_top" />}
      <div className={innerClass}>{children}</div>
      {ornaments && <DividerOrnament variant={block.dividerBottom} slot="ornament_bottom" />}
      <Gate block={block} />
      <Tail block={block} />
    </section>
  )
}
