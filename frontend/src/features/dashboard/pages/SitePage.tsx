import type { FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useSaveSiteSettings, useSiteSettings } from '../api'
import type { SiteValues } from '../types'
import { CheckField, ErrorList, SelectField, TextField, useFormErrors } from '../ui/forms'
import { PageHead, usePageTitle } from '../ui/page'
import { QueryState } from '../ui/table'
import { useToast } from '../ui/Toast'

const str = (values: FormData, key: string) => String(values.get(key) ?? '')

/** إعدادات الموقع: شريط المعاينة وروابط التواصل (‎templates/dashboard/site.html‎). */
export function SitePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { data, isPending, isError } = useSiteSettings()
  const save = useSaveSiteSettings()
  const errors = useFormErrors()
  usePageTitle(t('dashboard.site.pageTitle'))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const flag = (key: keyof SiteValues) => values.has(key)
    const body: SiteValues = {
      plansPublic: flag('plansPublic'),
      homeTemplatesPerRow: str(values, 'homeTemplatesPerRow') === '2' ? 2 : 1,
      ordersEnabled: flag('ordersEnabled'),
      whatsappEnabled: flag('whatsappEnabled'),
      whatsappNumber: str(values, 'whatsappNumber'),
      whatsappFloatEnabled: flag('whatsappFloatEnabled'),
      whatsappCtaMessage: str(values, 'whatsappCtaMessage'),
      previewCtaEnabled: flag('previewCtaEnabled'),
      previewCtaText: str(values, 'previewCtaText'),
      whatsappMessage: str(values, 'whatsappMessage'),
      facebookEnabled: flag('facebookEnabled'),
      facebookUrl: str(values, 'facebookUrl'),
      instagramEnabled: flag('instagramEnabled'),
      instagramUrl: str(values, 'instagramUrl'),
    }
    errors.clear()
    save.mutate(body, {
      onSuccess: () => toast.success(t('dashboard.site.saved')),
      onError: (error) => {
        if (errors.fail(error)) toast.error(t('dashboard.site.reviewData'))
        else toast.fail(error)
      },
    })
  }

  const state = data?.state
  const values = data?.values

  return (
    <>
      <PageHead title={t('dashboard.site.title')}>
        <Link className="btn btn--ghost" to="/dashboard/plans">
          {t('dashboard.site.backToPlans')}
        </Link>
      </PageHead>

      <QueryState loading={isPending} error={isError} />
      {data && state && values && (
        <>
          {/* التوجل مفتوح بس الشريط مش ظاهر لأن مفيش وسيلة تواصل — لازم نقولها بصوت عالي */}
          {state.previewCtaEnabled && !state.previewCtaReady && (
            <div
              className="card"
              data-cta-warning
              style={{ borderInlineStart: '4px solid var(--accent)', marginBottom: 18 }}
            >
              <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>{t('dashboard.site.warningTitle')}</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
                <Trans i18nKey="dashboard.site.warningBody" components={{ strong: <strong /> }} />
              </p>
            </div>
          )}

          <div
            className="grid"
            style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,.8fr)', alignItems: 'start' }}
          >
            <div className="card">
              <h2 style={{ fontSize: 17, marginTop: 0 }}>{t('dashboard.site.barTitle')}</h2>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
                <Trans i18nKey="dashboard.site.barBody" components={{ strong: <strong /> }} />
              </p>

              <form className="form" key={JSON.stringify(values)} onSubmit={onSubmit}>
                <ErrorList message={errors.formError} nonField />
                <CheckField name="plansPublic" label={t('dashboard.site.fields.plansPublic')} defaultChecked={values.plansPublic} />
                <SelectField
                  name="homeTemplatesPerRow"
                  label={t('dashboard.site.fields.homeTemplatesPerRow')}
                  defaultValue={String(values.homeTemplatesPerRow)}
                  help={t('dashboard.site.homeTemplatesPerRowHelp')}
                  helpSmall
                  error={errors.fields.homeTemplatesPerRow}
                >
                  <option value="1">{t('dashboard.site.perRow.one')}</option>
                  <option value="2">{t('dashboard.site.perRow.two')}</option>
                </SelectField>
                <CheckField name="ordersEnabled" label={t('dashboard.site.fields.ordersEnabled')} defaultChecked={values.ordersEnabled} />
                <CheckField name="whatsappEnabled" label={t('dashboard.site.fields.whatsappEnabled')} defaultChecked={values.whatsappEnabled} />
                <TextField
                  name="whatsappNumber"
                  label={t('dashboard.site.fields.whatsappNumber')}
                  placeholder="+201559403203"
                  dir="ltr"
                  maxLength={30}
                  defaultValue={values.whatsappNumber}
                  help={t('dashboard.site.whatsappNumberHelp')}
                  helpSmall
                  error={errors.fields.whatsappNumber}
                />
                <CheckField
                  name="whatsappFloatEnabled"
                  label={t('dashboard.site.fields.whatsappFloatEnabled')}
                  defaultChecked={values.whatsappFloatEnabled}
                />
                <TextField
                  name="whatsappCtaMessage"
                  label={t('dashboard.site.fields.whatsappCtaMessage')}
                  maxLength={300}
                  defaultValue={values.whatsappCtaMessage}
                  help={t('dashboard.site.whatsappCtaMessageHelp')}
                  helpSmall
                  error={errors.fields.whatsappCtaMessage}
                />
                <CheckField name="previewCtaEnabled" label={t('dashboard.site.fields.previewCtaEnabled')} defaultChecked={values.previewCtaEnabled} />
                <TextField
                  name="previewCtaText"
                  label={t('dashboard.site.fields.previewCtaText')}
                  maxLength={120}
                  required
                  defaultValue={values.previewCtaText}
                  error={errors.fields.previewCtaText}
                />
                <TextField
                  name="whatsappMessage"
                  label={t('dashboard.site.fields.whatsappMessage')}
                  maxLength={300}
                  required
                  defaultValue={values.whatsappMessage}
                  help={t('dashboard.site.whatsappMessageHelp')}
                  helpSmall
                  error={errors.fields.whatsappMessage}
                />
                <CheckField name="facebookEnabled" label={t('dashboard.site.fields.facebookEnabled')} defaultChecked={values.facebookEnabled} />
                <TextField
                  name="facebookUrl"
                  type="url"
                  label={t('dashboard.site.fields.facebookUrl')}
                  placeholder="https://facebook.com/…"
                  dir="ltr"
                  maxLength={300}
                  defaultValue={values.facebookUrl}
                  error={errors.fields.facebookUrl}
                />
                <CheckField name="instagramEnabled" label={t('dashboard.site.fields.instagramEnabled')} defaultChecked={values.instagramEnabled} />
                <TextField
                  name="instagramUrl"
                  type="url"
                  label={t('dashboard.site.fields.instagramUrl')}
                  placeholder="https://instagram.com/…"
                  dir="ltr"
                  maxLength={300}
                  defaultValue={values.instagramUrl}
                  error={errors.fields.instagramUrl}
                />
                <button className="btn btn--gold btn--block" type="submit" disabled={save.isPending}>
                  {t('dashboard.common.save')}
                </button>
              </form>
            </div>

            <aside className="card">
              <h2 style={{ fontSize: 17, marginTop: 0 }}>{t('dashboard.site.tryTitle')}</h2>
              {data.sample ? (
                <>
                  <p className="muted" style={{ fontSize: 13.5 }}>
                    {t('dashboard.site.tryBody')}
                  </p>
                  <Link className="btn btn--ghost btn--block" to={data.sample.previewUrl}>
                    {t('dashboard.site.previewSample', { name: data.sample.name })}
                  </Link>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 13.5 }}>
                  {t('dashboard.site.noSample')}
                </p>
              )}

              <h3 style={{ fontSize: 14, marginBottom: 6 }}>{t('dashboard.site.stateTitle')}</h3>
              <ul className="muted" style={{ fontSize: 13, paddingInlineStart: 18, margin: 0 }}>
                <li>
                  {t('dashboard.site.state.bar')}{' '}
                  {state.previewCtaReady ? (
                    <strong>{t('dashboard.site.state.visible')}</strong>
                  ) : state.previewCtaEnabled ? (
                    <strong>{t('dashboard.site.state.enabledHidden')}</strong>
                  ) : (
                    t('dashboard.site.state.off')
                  )}
                </li>
                <li>
                  {t('dashboard.site.state.whatsapp')}{' '}
                  {state.whatsappNumber ? (
                    <strong dir="ltr">{state.whatsappNumber}</strong>
                  ) : (
                    t('dashboard.site.state.offOrNoNumber')
                  )}
                </li>
                <li>
                  {t('dashboard.site.state.facebook')}{' '}
                  {state.facebookLinked ? <strong>{t('dashboard.site.state.linked')}</strong> : t('dashboard.site.state.offOrEmpty')}
                </li>
                <li>
                  {t('dashboard.site.state.instagram')}{' '}
                  {state.instagramLinked ? <strong>{t('dashboard.site.state.linked')}</strong> : t('dashboard.site.state.offOrEmpty')}
                </li>
                <li>
                  {t('dashboard.site.state.orders')}{' '}
                  {state.ordersEnabled ? (
                    <strong>{t('dashboard.site.state.open')}</strong>
                  ) : (
                    t('dashboard.site.state.closed')
                  )}
                </li>
                <li>
                  {t('dashboard.site.state.float')}{' '}
                  {state.whatsappFloatReady ? (
                    <strong>{t('dashboard.site.state.visible')}</strong>
                  ) : state.whatsappFloatEnabled ? (
                    <strong>{t('dashboard.site.state.floatHidden')}</strong>
                  ) : (
                    t('dashboard.site.state.off')
                  )}
                </li>
              </ul>
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                {t('dashboard.site.footnote')}
              </p>
            </aside>
          </div>
        </>
      )}
    </>
  )
}
