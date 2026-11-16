import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** كل خطوة ليها أيقونة جوّه الدايرة، والرقم بقى علامة صغيرة فوق العنوان. */
const STEPS: { key: 'pick' | 'send' | 'design' | 'link'; icon: ReactNode }[] = [
  {
    key: 'pick',
    icon: (
      <>
        <rect x="4" y="4" width="7" height="9" rx="1.5" />
        <rect x="13" y="4" width="7" height="5" rx="1.5" />
        <rect x="13" y="11" width="7" height="9" rx="1.5" />
        <rect x="4" y="15" width="7" height="5" rx="1.5" />
      </>
    ),
  },
  {
    key: 'send',
    icon: (
      <>
        <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5Z" />
        <path d="M8 9.5h8M8 12.5h5" />
      </>
    ),
  },
  {
    key: 'design',
    icon: (
      <>
        <path d="m14.5 5.5 4 4L9 19H5v-4l9.5-9.5Z" />
        <path d="m12.5 7.5 4 4" />
      </>
    ),
  },
  {
    key: 'link',
    icon: (
      <>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
      </>
    ),
  },
]

/**
 * المنحنى بيعدّي على ميداليات الكروت الأربعة (من اليمين لتحت لحد الشمال لفوق).
 * الـviewBox ‏1000×150 بيتمطّ على عرض الحاوية، والنقط مقاسة على إن كل كارت
 * أعلى من اللي قبله بـ40px (شوف ‎--rise‎ في showcase.css).
 */
const JOURNEY_PATH = 'M875,135 C780,135 720,95 625,95 S470,55 375,55 S220,15 125,15'

export function StepsSection() {
  const { t } = useTranslation()
  return (
    <section className="section section--alt section--steps" id="how">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.steps.eyebrow')}</p>
          <h2>{t('public.steps.title')}</h2>
        </div>
        {/* «سلّم لحد يوم الفرح»: الكروت طالعة لفوق خطوة ورا خطوة، ومتوصّلة بمنحنى
            دهبي بيترسم لما القسم يظهر ونقطة منوّرة بتمشي عليه. ‎data-reveal‎ على
            الحاوية هو اللي بيشغّل الرسم وطلوع الكروت ورا بعض. */}
        <div className="journey" data-reveal>
          <svg className="journey-path" viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true">
            <path className="journey-path-base" d={JOURNEY_PATH} />
            <path className="journey-path-gold" d={JOURNEY_PATH} pathLength={1} />
            <circle className="journey-dot" r="5">
              <animateMotion dur="6s" repeatCount="indefinite" path={JOURNEY_PATH} />
            </circle>
          </svg>
          {STEPS.map(({ key, icon }, i) => (
            <div className="journey-card" key={key} style={{ '--i': i } as CSSProperties}>
              <span className="journey-medal">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {icon}
                </svg>
              </span>
              <span className="journey-num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{t(`public.steps.${key}.title`)}</h3>
              <p>{t(`public.steps.${key}.text`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
