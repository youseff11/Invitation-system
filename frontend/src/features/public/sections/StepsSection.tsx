import { useTranslation } from 'react-i18next'

const STEPS = ['pick', 'send', 'design', 'link'] as const
const NUMS = ['١', '٢', '٣', '٤']

/** الخطوات: أربع أقواس زي بوابات متتالية، بينها معيّنات دهبي؛ آخر قوس (الرابط) هو المحطة المنوّرة. */
export function StepsSection() {
  const { t } = useTranslation()
  return (
    <section className="section section--alt" id="how">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.steps.eyebrow')}</p>
          <h2>{t('public.steps.title')}</h2>
        </div>
        <ol className="arches">
          {STEPS.map((step, i) => (
            <li className={'arch' + (i === STEPS.length - 1 ? ' arch--final' : '')} key={step} data-reveal data-reveal-stagger>
              <div className="arch-frame">
                <span className="arch-key" aria-hidden="true" />
                <span className="arch-num" aria-hidden="true">
                  {NUMS[i]}
                </span>
                <span className="arch-rule" aria-hidden="true" />
                <h3>{t(`public.steps.${step}.title`)}</h3>
                <p>{t(`public.steps.${step}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
