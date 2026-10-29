import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { HeroInfo } from '@/api/types'

import { ShootingStars, StarField } from '../fx'
import { useLang } from '../text'
import { useHeroIdle } from '../useHeroIdle'

/** خلفيات الهيرو المخصّصة: نفس تدرّج الـselectors في public.css (والأحدث في الترتيب بيكسب) */
function heroImagesCss(images: HeroInfo['images'] | undefined): string {
  if (!images) return ''
  const rule = (selector: string, url: string) => (url ? `${selector}{--hero-img:url("${encodeURI(url)}")}` : '')
  return [
    rule('.hero-art', images.lightAr),
    rule('html[lang="en"] .hero-art', images.lightEn),
    rule('[data-theme="dark"] .hero-art', images.darkAr),
    rule('html[lang="en"][data-theme="dark"] .hero-art', images.darkEn),
  ].join('')
}

export function HeroSection({ plansPublic, hero }: { plansPublic: boolean; hero?: HeroInfo }) {
  const { t } = useTranslation()
  const lang = useLang()
  // أي حقل فاضي في اللوحة بيرجع للنص الافتراضي المترجم
  const custom = hero?.text[lang]
  const text = (value: string | undefined, key: string) => value?.trim() || t(`public.hero.${key}`)
  const trust = ['templates', 'delivery', 'editable'].map((name, index) => ({
    value: custom?.trust[index]?.value?.trim() || t(`public.hero.trust.${name}Value`),
    label: custom?.trust[index]?.label?.trim() || t(`public.hero.trust.${name}Label`),
  }))
  const imagesCss = heroImagesCss(hero?.images)
  const ref = useRef<HTMLElement>(null)
  const idle = useHeroIdle(ref)

  return (
    <section className="hero" ref={ref}>
      {imagesCss && <style>{imagesCss}</style>}
      <div className="hero-art">
        <span className="sr-only">{t('public.hero.alt')}</span>
        {/* نجوم بتقع فوق صورة الهيرو + شهاب بيعدّي كل شوية. جوّه ‎.hero-art‎ عن
            قصد: على التليفون الكلام بينزل تحت الصورة، فكده المؤثرات تفضل على
            الصورة بس ومتعديش على النص. */}
        <StarField className="hero-sparks" count={30} idle={idle} />
        <ShootingStars idle={idle} />
      </div>
      <div className="hero-copy">
        <div className="hero-copy-in" data-reveal>
          <span className="orn orn--crown" aria-hidden="true">
            <svg viewBox="0 0 180 34" focusable="false">
              <path d="M14 26c22 0 40-6 55-16" />
              <path d="M166 26c-22 0-40-6-55-16" />
              <path d="M42 26c14 0 26-4 36-10" />
              <path d="M138 26c-14 0-26-4-36-10" />
              <path
                className="orn-fill"
                d="M90 2c1.7 5.4 4.6 8.3 10 10-5.4 1.7-8.3 4.6-10 10-1.7-5.4-4.6-8.3-10-10 5.4-1.7 8.3-4.6 10-10Z"
              />
              <circle className="orn-fill" cx="11" cy="26" r="1.7" />
              <circle className="orn-fill" cx="169" cy="26" r="1.7" />
            </svg>
          </span>
          <h1>
            <span className="h1-top">{text(custom?.top, 'top')}</span>
            <span className="h1-main">{text(custom?.main, 'main')}</span>
          </h1>
          <div className="hero-rule" aria-hidden="true">
            <i />
            <svg className="orn-diamond" viewBox="0 0 34 18" focusable="false">
              <path
                d="M17 1c1.6 5.2 5 8 11 8-6 0-9.4 2.8-11 8-1.6-5.2-5-8-11-8 6 0 9.4-2.8 11-8Z"
                className="orn-fill"
              />
            </svg>
            <i />
          </div>
          <p className="hero-sub">{text(custom?.sub, 'sub')}</p>
          <div className="hero-actions">
            <Link className="btn btn--gold btn--lg btn--shine" to="/templates">
              <span>{text(custom?.cta, 'start')}</span>
              <svg className="btn-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h13m0 0-5-5m5 5-5 5" />
              </svg>
            </Link>
            {plansPublic && (
              <Link className="btn btn--outline btn--lg" to={{ pathname: '/', hash: '#plans' }}>
                <span>{text(custom?.plans, 'plans')}</span>
              </Link>
            )}
          </div>
          {/* القيمة جوّه ‎<span>‎ جوّه ‎<b>‎ زي الموقع القديم (وسم ‎bi‎ بيطبع span) — قاعدة
              ‎.hero-trust span‎ بتصغّرها وتخليها رمادي، ودي الصورة الفعلية في القديم. */}
          <ul className="hero-trust" aria-hidden="true">
            {trust.map((item, index) => (
              <li key={index}>
                <b>
                  <span>{item.value}</span>
                </b>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
