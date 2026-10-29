import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { fetchTranslations } from '../api'
import { FieldRenderer } from '../fields'
import { altLangOf, baseLangOf, useEditor } from '../store'
import type { FieldSpec, TranslationRow, TranslationRows } from '../types'
import { useEditorUi } from '../ui'

const DIR = { ar: 'rtl', en: 'ltr' } as const
const LOAD_WAIT = 400

/** القيمة المكتوبة بتتحفظ مقصوصة، لكن الخانة لازم تسيب المستخدم يكتب مسافات بين الكلمات. */
function useDraft(stored: string) {
  const [draft, setDraft] = useState(stored)
  useEffect(() => {
    // تغيير من بره (تراجع/إعادة/مسح) — مش من الكتابة نفسها
    setDraft((current) => (current.trim() === stored ? current : stored))
  }, [stored])
  return [draft, setDraft] as const
}

const FONT_SPEC: FieldSpec = { key: 'font', label: '', type: 'font', default: '', group: '' }
const SIZE_SPEC: FieldSpec = { key: 'size', label: '', type: 'range', default: 0, group: '', min: 0, max: 160, step: 1, unit: 'px' }

/**
 * ترس خط وحجم النص المترجَم — الزرار بيقعد جنب الخانة واللوحة تحتها، فبنرجّعهم منفصلين.
 * اللوحة بتتبني عند أول فتح بس (قايمة الخطوط تقيلة).
 */
function useStyleGear(rowKey: string): { gear: ReactNode; panel: ReactNode } {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [built, setBuilt] = useState(false)
  const alt = useEditor((s) => altLangOf(s.doc))
  const style = useEditor((s) => s.doc.i18n_style?.[alt]?.[rowKey])
  const setStyle = useEditor((s) => s.setTranslationStyle)
  const gear = (
    <button
      type="button"
      className={`ed-font-gear${style ? ' is-set' : ''}`}
        title={t('editorInline.i18n.gear')}
      aria-label={t('editorInline.i18n.gearAria')}
      aria-expanded={open}
      onClick={() => {
        setBuilt(true)
        setOpen((v) => !v)
      }}
    >
      ⚙
    </button>
  )
  const panel = built ? (
    <div className="ed-inline-font-panel" hidden={!open}>
      <FieldRenderer
        spec={{ ...FONT_SPEC, label: t('editorInline.i18n.styleFont'), help: t('editorInline.i18n.styleFontHelp') }}
        value={style?.font ?? ''}
        onChange={(v) => setStyle(rowKey, 'font', String(v ?? ''))}
      />
      <FieldRenderer
        spec={{ ...SIZE_SPEC, label: t('editorInline.i18n.styleSize'), help: t('editorInline.i18n.styleSizeHelp') }}
        value={style?.size ?? 0}
        onChange={(v) => setStyle(rowKey, 'size', Number(v) || 0)}
      />
    </div>
  ) : null
  return { gear, panel }
}

function Row({ row, alt, base }: { row: TranslationRow; alt: 'ar' | 'en'; base: 'ar' | 'en' }) {
  const { t } = useTranslation()
  const stored = useEditor((s) => s.doc.i18n?.[alt]?.[row.key] ?? '')
  const setTranslation = useEditor((s) => s.setTranslation)
  const [draft, setDraft] = useDraft(stored)
  const { gear, panel } = useStyleGear(row.key)
  const multiline = row.value.length > 60 || row.value.includes('\n')
  const props = {
    className: 'ed-input',
    dir: DIR[alt],
    placeholder: t(`editorInline.i18n.placeholder.${alt}`),
    value: draft,
    'aria-label': row.label,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value)
      setTranslation(row.key, e.target.value)
    },
  }
  return (
    <div className="ed-field" data-i18n-key={row.key}>
      <label>
        <span>{row.label}</span>
      </label>
      <p className="ed-i18n-src" dir={DIR[base]}>
        {row.value}
      </p>
      <div className="ed-i18n-row">
        {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
        {gear}
      </div>
      {panel}
    </div>
  )
}

/** تبويب الترجمة: النسخة التانية لكل نص في الدعوة (يدوي، من غير ترجمة آلية). */
export function TranslationPanel() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const mode = useEditor((s) => s.mode)
  const id = useEditor((s) => s.id)
  const contentRev = useEditor((s) => s.contentRev)
  const base = useEditor((s) => baseLangOf(s.doc))
  const alt = useEditor((s) => altLangOf(s.doc))
  const table = useEditor((s) => s.doc.i18n?.[altLangOf(s.doc)])
  const previewLang = useEditor((s) => s.previewLang)
  const setPreviewLang = useEditor((s) => s.setPreviewLang)
  const clear = useEditor((s) => s.clearTranslation)
  const prune = useEditor((s) => s.pruneTranslations)
  const [data, setData] = useState<TranslationRows | null>(null)
  const [failed, setFailed] = useState(false)

  // صفوف النصوص من السيرفر (نفس مفاتيح العارض) — بتتجدّد بعد وقفة من آخر تعديل في المحتوى
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(
      () => {
        const { doc, fields } = useEditor.getState()
        fetchTranslations(mode, id, doc, fields, controller.signal)
          .then((rows) => {
            setData(rows)
            setFailed(false)
            // مفاتيح اتخزّنت لنص اتغيّر أو اتمسح بتفضل ميّتة في المستند: نشيلها عشان العدّاد يقول الحقيقة
            prune(new Set(rows.entries.map((r) => r.key)))
          })
          .catch(() => {
            if (!controller.signal.aborted) setFailed(true)
          })
      },
      data ? LOAD_WAIT : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // ‎data‎ بس بيحدد الوقفة (أول مرة فورية) — مش سبب لإعادة الجلب
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, id, contentRev, prune])

  const groups = useMemo(() => {
    const out = new Map<string, TranslationRow[]>()
    for (const row of data?.entries ?? []) out.set(row.group, [...(out.get(row.group) ?? []), row])
    return [...out]
  }, [data])

  const langName = (l: 'ar' | 'en') => t(`editorInline.i18n.langName.${l}`)
  const done = Object.keys(table ?? {}).length
  const total = data?.entries.length ?? 0
  const showingAlt = previewLang === alt

  return (
    <div data-pane="i18n">
      <p className="ed-kicker">{t('editorInline.i18n.kicker', { lang: langName(alt) })}</p>
      <p className="ed-hint">
        {t('editorInline.i18n.intro', { base: t(`editorInline.i18n.langAdj.${base}`), lang: langName(alt) })}
      </p>
      <p className="ed-hint" data-i18n-count>
        {done ? t('editorInline.i18n.counter', { done, total }) : t('editorInline.i18n.counterNone')}
      </p>

      <button
        type="button"
        className="ed-btn ed-btn--sm ed-btn--block"
        onClick={() => setPreviewLang(showingAlt ? '' : alt)}
      >
        {showingAlt
          ? t('editorInline.i18n.peekBase', { lang: t(`editorInline.i18n.langAdj.${base}`) })
          : t('editorInline.i18n.peekAlt', { lang: langName(alt) })}
      </button>

      {!data && !failed && <p className="ed-empty">{t('editorInline.i18n.loading')}</p>}
      {failed && !data && <p className="ed-empty">{t('editorInline.i18n.failed')}</p>}
      {data && !groups.length && <p className="ed-empty">{t('editorInline.i18n.empty')}</p>}

      {groups.map(([name, rows]) => (
        <details className="ed-group" open key={name}>
          <summary>
            <span>{name}</span>
          </summary>
          <div className="ed-group-body">
            {rows.map((row) => (
              <Row key={row.key} row={row} alt={alt} base={base} />
            ))}
          </div>
        </details>
      ))}

      {done > 0 && (
        <button
          type="button"
          className="ed-btn ed-btn--sm ed-btn--block"
          onClick={async () => {
            if (!(await ui.confirm(t('editorInline.i18n.clearConfirm', { lang: langName(alt) }), { danger: true, confirmLabel: t('editorInline.i18n.clear') }))) return
            clear()
            ui.toast(t('editorInline.i18n.cleared', { lang: langName(alt) }), 'ok')
          }}
        >
          {t('editorInline.i18n.clear')}
        </button>
      )}
    </div>
  )
}
