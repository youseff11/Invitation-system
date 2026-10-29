import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { pick, useLang } from '../text'
import type { PublicFaq } from '../types'

/** نفس ‎linebreaksbr‎: كل سطر جديد بقى ‎<br>‎، والنص نفسه بيتهرّب لوحده (React). */
function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split(/\r\n|\r|\n/).map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  )
}

/** الأسئلة الشائعة — القسم مش بيظهر لو مفيش أسئلة. */
export function FaqSection({ faqs }: { faqs: PublicFaq[] | undefined }) {
  const { t } = useTranslation()
  const lang = useLang()
  if (!faqs?.length) return null

  return (
    <section className="section section--faq" id="faq">
      <div className="wrap wrap--narrow">
        <div className="section-head" data-reveal>
          <p className="eyebrow">{t('public.faq.eyebrow')}</p>
          <h2>{t('public.faq.title')}</h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq, i) => (
            <details className="faq-item" key={faq.id} data-reveal data-reveal-stagger open={i === 0}>
              <summary>{pick(lang, faq.question, faq.questionEn)}</summary>
              <div className="faq-answer">
                <Lines text={pick(lang, faq.answer, faq.answerEn)} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
