import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { collectColors, replaceColor, type ColorUse } from '../imported/colors'
import { useEditor } from '../store'
import type { DocBlock } from '../types'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * «ألوان القسم» لقسم مستورد: كل لون مكتوب في ‎css‎ و‎html‎ القسم كـswatch، وتغييره بيبدّله في كل مكان مذكور فيه.
 * القايمة بتتجمّع مرة وتفضل ثابتة وانت بتسحب في منتقي اللون (وإلا الـinput كان هيتبدّل تحت إيدك)؛
 * وبتتجمّع من جديد لو النص اتغيّر من حاجة تانية (تراجع، تعديل كود…).
 */
export function ColorGroup({ block }: { block: DocBlock }) {
  const { t } = useTranslation()
  const setProps = useEditor((s) => s.setProps)
  const css = text(block.props.css)
  const html = text(block.props.html)
  const signature = `${css}\u0000${html}`

  const [view, setView] = useState<{ signature: string; colors: ColorUse[] }>(() => ({ signature, colors: collectColors(css, html) }))
  // النص اتغيّر من غير ما إحنا نكتبه (تراجع، تعديل كود…)؟ نجمع من جديد. اللي بنكتبه إحنا بيسجّل توقيعه تحت.
  if (view.signature !== signature) setView({ signature, colors: collectColors(css, html) })

  const change = (index: number, hex: string) => {
    const color = view.colors[index]
    const next = { css: replaceColor(css, color.raws, hex), html: replaceColor(html, color.raws, hex) }
    // الجولة الجاية تبدّل اللون الجديد، والصف بيفضل في مكانه
    setView({
      signature: `${next.css}\u0000${next.html}`,
      colors: view.colors.map((c, i) => (i === index ? { ...c, hex, raws: [hex] } : c)),
    })
    setProps(block.id, next, `colors:${block.id}:${index}`)
  }

  return (
    <details className="ed-group">
      <summary>
        <span>{t('editorInline.colors.title')}</span>
      </summary>
      <div className="ed-group-body">
        {view.colors.length === 0 ? (
          <p className="ed-hint">{t('editorInline.colors.empty')}</p>
        ) : (
          <>
            <p className="ed-hint">{t('editorInline.colors.hint')}</p>
            <div className="ed-swatches">
              {view.colors.map((color, index) => (
                <label key={index} className="ed-swatch">
                  <input type="color" value={color.hex} onChange={(e) => change(index, e.target.value)} />
                  <span className="ed-swatch-hex">{color.hex}</span>
                  <span className="ed-swatch-n">{color.count}×</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  )
}
