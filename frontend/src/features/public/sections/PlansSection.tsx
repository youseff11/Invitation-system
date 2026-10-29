import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { SiteInfo } from '@/api/types'
import { pick, useLang } from '../text'
import type { PublicPlan } from '../types'

interface Props {
  site: SiteInfo
  plans: PublicPlan[] | undefined
}

/** الباقات والأسعار — القسم كله بيتخفي من «إعدادات الموقع» لو مش عايز تعلن أسعارك. */
export function PlansSection({ site, plans }: Props) {
  const { t } = useTranslation()
  const lang = useLang()
  // إضافات باقة واحدة بس مفتوحة في نفس الوقت (زي الموقع القديم)
  const [openPlan, setOpenPlan] = useState<number | null>(null)

  const whatsappUrl = site.whatsapp.url

  return (
    <section className="section" id="plans">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.plans.eyebrow')}</p>
          <h2>{t('public.plans.title')}</h2>
        </div>
        <div className="grid grid--3">
          {plans?.map((plan) => {
            const name = pick(lang, plan.name, plan.nameEn)
            const bullets = lang === 'en' && plan.bulletsEn.length ? plan.bulletsEn : plan.bullets
            const hasAddons = plan.addons.length > 0
            const isOpen = openPlan === plan.id
            const choose = t('public.plans.choose', { plan: name })
            return (
              <div key={plan.id} className={'plan' + (plan.isFeatured ? ' plan--featured' : '')}>
                {plan.isFeatured && <span className="plan-badge">{t('public.plans.popular')}</span>}
                <h3>{name}</h3>
                {(plan.tagline || plan.taglineEn) && (
                  <p className="muted plan-tagline">{pick(lang, plan.tagline, plan.taglineEn)}</p>
                )}
                <div className="plan-price">
                  {plan.price} <small>{site.currency}</small>
                </div>
                <ul>
                  {bullets.map((bullet, i) => (
                    <li key={i}>{bullet}</li>
                  ))}
                </ul>

                <div className="plan-bottom-actions">
                  {hasAddons && (
                    <div className={'plan-addons' + (isOpen ? ' is-open' : '')}>
                      <p className="plan-addons-title">{t('public.plans.addonsTitle')}</p>
                      <ul className="plan-addons-list">
                        {plan.addons.map((addon) => (
                          <li key={addon.id}>
                            <span>{pick(lang, addon.name, addon.nameEn)}</span>
                            <b>
                              +{addon.price} {site.currency}
                            </b>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {site.ordersEnabled ? (
                    <Link className="btn btn--gold btn--block" to={{ pathname: '/', hash: '#contact' }}>
                      {choose}
                    </Link>
                  ) : (
                    whatsappUrl && (
                      <a className="btn btn--gold btn--block" href={whatsappUrl} target="_blank" rel="noopener">
                        {choose}
                      </a>
                    )
                  )}

                  {hasAddons ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--block toggle-addons-btn"
                      aria-expanded={isOpen}
                      onClick={() => setOpenPlan(isOpen ? null : plan.id)}
                    >
                      {isOpen ? t('public.plans.hideAddons') : t('public.plans.showAddons')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--block" disabled>
                      {t('public.plans.noAddons')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
