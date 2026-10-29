import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FieldValue, FileValue, Values } from './types'

type Lang = 'ar' | 'en'
type Theme = 'light' | 'dark'
export interface HeroView {
  lang: Lang
  theme: Theme
}

const DEFAULT_BG: Record<Theme, Record<Lang, string>> = {
  light: { ar: '/static/images/home-arabic-light.webp', en: '/static/images/home-english-light.webp' },
  dark: { ar: '/static/images/home-arabic-dark.webp', en: '/static/images/home-english-dark.webp' },
}

/** الحقل اللي المستخدم واقف عليه → أنهي عنصر في المعاينة يتلوّن */
function targetOf(field: string): string {
  if (field.startsWith('bg_')) return 'bg'
  const trust = /^trust(\d)_(value|label)_/.exec(field)
  if (trust) return `trust${trust[1]}${trust[2]}`
  return field.replace(/_(ar|en)$/, '')
}

/** المظهر/اللغة اللي الحقل بتاعهم — عشان المعاينة تقلب لوحدها لما تقف على حقل إنجليزي أو دارك */
export function viewForField(field: string, current: HeroView): HeroView {
  const lang = field.endsWith('_ar') ? 'ar' : field.endsWith('_en') ? 'en' : current.lang
  const theme = field.startsWith('bg_dark_') ? 'dark' : field.startsWith('bg_light_') ? 'light' : current.theme
  return { lang, theme }
}

/** الحقل ظاهر في النموذج؟ — اللي ليه علاقة بالمظهر/اللغة المختارين في المعاينة بس. */
export function heroFieldVisible(field: string, view: HeroView): boolean {
  if (field.startsWith('bg_')) return field === `bg_${view.theme}_${view.lang}`
  if (field.endsWith('_ar')) return view.lang === 'ar'
  if (field.endsWith('_en')) return view.lang === 'en'
  return true
}

/** مفتاح الترجمة اللي بيدّي النص الأصلي للحقل (اللي بيظهر شفاف في الخانة). */
export function heroDefaultKey(field: string): string {
  const trust = /^trust(\d)_(value|label)_/.exec(field)
  if (trust) return `trust.${['templates', 'delivery', 'editable'][Number(trust[1]) - 1]}${trust[2] === 'value' ? 'Value' : 'Label'}`
  const name = field.replace(/_(ar|en)$/, '')
  return name === 'cta' ? 'start' : name
}

const fileUrl = (value: FieldValue | undefined) =>
  value && typeof value === 'object' && 'url' in value ? (value as FileValue).url : ''

/** معاينة حيّة للهيرو جنب النموذج: الكلام والخلفية من القيم الحالية (حتى غير المحفوظة) والعنصر المعدَّل بيتلوّن. */
export function HeroPreview({
  values,
  files,
  focus,
  focusLabel,
  view,
  onView,
}: {
  values: Values
  files: Record<string, File>
  focus: string
  /** تسمية الحقل الواقف عليه (للتلميحة) */
  focusLabel: string
  view: HeroView
  onView: (view: HeroView) => void
}) {
  const { t, i18n } = useTranslation()
  const { lang, theme } = view
  const active = focus ? targetOf(focus) : ''

  // صورة اتختارت ولسه ماتحفظتش: رابط مؤقت من الملف نفسه
  const key = `bg_${theme}_${lang}`
  const picked = files[key]
  const [local, setLocal] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => {
    if (!picked) return
    const url = URL.createObjectURL(picked)
    setLocal({ file: picked, url })
    return () => URL.revokeObjectURL(url)
  }, [picked])
  const background = picked && local?.file === picked ? local.url : fileUrl(values[key]) || DEFAULT_BG[theme][lang]

  const text = useMemo(() => {
    const word = (name: string, defaultKey: string) => {
      const custom = values[`${name}_${lang}`]
      return (typeof custom === 'string' && custom.trim()) || String(i18n.t(`public.hero.${defaultKey}`, { lng: lang }))
    }
    const trust = ['templates', 'delivery', 'editable'].map((name, index) => ({
      value: word(`trust${index + 1}_value`, `trust.${name}Value`),
      label: word(`trust${index + 1}_label`, `trust.${name}Label`),
    }))
    return {
      top: word('top', 'top'),
      main: word('main', 'main'),
      sub: word('sub', 'sub'),
      cta: word('cta', 'start'),
      plans: word('plans', 'plans'),
      trust,
    }
  }, [values, lang, i18n])

  const mark = (name: string) => (active === name ? 'hp-mark is-active' : 'hp-mark')

  return (
    <aside className="hp" aria-label={t('dataadmin.hero.preview')}>
      <div className="hp-bar">
        <strong>{t('dataadmin.hero.preview')}</strong>
        <div className="hp-seg" role="group" aria-label={t('dataadmin.hero.language')}>
          {(['ar', 'en'] as const).map((value) => (
            <button key={value} type="button" className={lang === value ? 'is-on' : undefined} onClick={() => onView({ ...view, lang: value })}>
              {value === 'ar' ? 'عربي' : 'English'}
            </button>
          ))}
        </div>
        <div className="hp-seg" role="group" aria-label={t('dataadmin.hero.theme')}>
          {(['light', 'dark'] as const).map((value) => (
            <button key={value} type="button" className={theme === value ? 'is-on' : undefined} onClick={() => onView({ ...view, theme: value })}>
              {t(`dataadmin.hero.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={`hp-stage ${active === 'bg' ? 'is-active' : ''}`} data-theme={theme} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="hp-art" style={{ backgroundImage: `url("${background}")` }} data-testid="hero-bg" />
        <div className="hp-copy">
          <p className={`hp-top ${mark('top')}`}>{text.top}</p>
          <p className={`hp-main ${mark('main')}`}>{text.main}</p>
          <i className="hp-rule" aria-hidden="true" />
          <p className={`hp-sub ${mark('sub')}`}>{text.sub}</p>
          <div className="hp-actions">
            <span className={`hp-btn hp-btn--gold ${mark('cta')}`}>{text.cta}</span>
            <span className={`hp-btn ${mark('plans')}`}>{text.plans}</span>
          </div>
          <ul className="hp-trust">
            {text.trust.map((item, index) => (
              <li key={index}>
                <b className={mark(`trust${index + 1}value`)}>{item.value}</b>
                <span className={mark(`trust${index + 1}label`)}>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="hp-hint muted">{active ? t('dataadmin.hero.editing', { field: focusLabel }) : t('dataadmin.hero.hint')}</p>
    </aside>
  )
}
