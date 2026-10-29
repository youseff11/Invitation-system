import { useId } from 'react'
import type { FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import { useDeleteAddon, usePlans, useSaveAddon, useSavePlan, useToggleAddon } from '../api'
import type { AddonBody, AddonRow, PlanRow } from '../types'
import { useConfirm } from '../ui/ConfirmDialog'
import { CheckField, ErrorList, TextField, useFormErrors } from '../ui/forms'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState, Table } from '../ui/table'
import { useToast } from '../ui/Toast'

const str = (values: FormData, key: string) => String(values.get(key) ?? '')

/** صف باقة بتعديل سريع للاسم والسعر — الحقول مربوطة بفورم مخفي بره الجدول عن طريق ‎form=‎. */
function PlanRowEditor({ plan, currency, pending }: { plan: PlanRow; currency: string; pending: boolean }) {
  const { t } = useTranslation()
  const formId = `plan-${plan.id}`

  return (
    <tr>
      <td className="cell--title">
        <input
          className="cell-input cell-input--name"
          form={formId}
          name="name"
          defaultValue={plan.name}
          aria-label={t('dashboard.plans.cols.plan')}
        />
        {plan.isFeatured && <span className="pill plan-featured">{t('dashboard.plans.featured')}</span>}
      </td>
      <td data-label={t('dashboard.plans.cols.price')}>
        <div className="plan-price">
          <div className="plan-price-row">
            <input
              className="cell-input"
              form={formId}
              name="price"
              type="number"
              min={0}
              step={1}
              defaultValue={plan.price}
              aria-label={t('dashboard.plans.cols.price')}
            />
            <small className="muted">{currency}</small>
          </div>
          <input
            className="cell-input"
            form={formId}
            name="oldPrice"
            type="number"
            min={0}
            step={1}
            placeholder={t('dashboard.plans.oldPrice')}
            defaultValue={plan.oldPrice}
            aria-label={t('dashboard.plans.oldPrice')}
          />
        </div>
      </td>
      <td className="cell--wide cell--features" data-label={t('dashboard.plans.cols.features')}>
        {plan.features.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <div className="plan-features">
            {plan.features.map((feature) => (
              <code key={feature}>{feature}</code>
            ))}
          </div>
        )}
      </td>
      <td data-label={t('dashboard.plans.cols.status')}>
        <label className="field field--check" style={{ margin: 0 }}>
          <input type="checkbox" form={formId} name="isActive" defaultChecked={plan.isActive} />
          <span>{t('dashboard.plans.displayed')}</span>
        </label>
      </td>
      <td className="cell--actions">
        <div className="row-actions">
          <button className="btn btn--gold btn--sm" type="submit" form={formId} disabled={pending}>
            {t('dashboard.common.save')}
          </button>
          <a className="btn btn--ghost btn--sm" href={plan.adminUrl}>
            {t('dashboard.plans.fullEdit')}
          </a>
        </div>
      </td>
    </tr>
  )
}

/** الباقات والإضافات (‎templates/dashboard/plans.html‎). */
export function PlansPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { data: site } = useSite()
  const [params] = useSearchParams()
  const { data, isPending, isError } = usePlans()
  const savePlan = useSavePlan()
  const saveAddon = useSaveAddon()
  const toggleAddon = useToggleAddon()
  const deleteAddon = useDeleteAddon()
  const errors = useFormErrors()
  const planChecksId = useId()
  usePageTitle(t('dashboard.plans.pageTitle'))

  const currency = site?.currency ?? ''
  const editId = Number(params.get('edit')) || null
  const editing: AddonRow | null = (editId && data?.addons.find((addon) => addon.id === editId)) || null

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const body: AddonBody = {
      name: str(values, 'name'),
      nameEn: str(values, 'nameEn'),
      code: str(values, 'code'),
      price: str(values, 'price'),
      description: str(values, 'description'),
      plans: values.getAll('plans').map(Number),
      isActive: values.has('isActive'),
      sortOrder: Number(str(values, 'sortOrder')) || 0,
    }
    errors.clear()
    saveAddon.mutate(
      { id: editing?.id ?? null, body },
      {
        onSuccess: (addon) => {
          toast.success(t(editing ? 'dashboard.plans.addonSaved' : 'dashboard.plans.addonAdded', { name: addon.name }))
          if (editing) navigate('/dashboard/plans')
          else form.reset()
        },
        onError: (error) => {
          if (errors.fail(error)) toast.error(t('dashboard.plans.reviewData'))
          else toast.fail(error)
        },
      },
    )
  }

  function onSavePlan(plan: PlanRow, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    savePlan.mutate(
      {
        id: plan.id,
        body: {
          name: str(values, 'name'),
          price: str(values, 'price'),
          oldPrice: str(values, 'oldPrice'),
          isActive: values.has('isActive'),
        },
      },
      {
        onSuccess: (saved) => toast.success(t('dashboard.plans.planSaved', { name: saved.name })),
        onError: toast.fail,
      },
    )
  }

  function onToggle(addon: AddonRow) {
    toggleAddon.mutate(addon.id, {
      onSuccess: (saved) =>
        toast.success(t(saved.isActive ? 'dashboard.plans.enabled' : 'dashboard.plans.disabled', { name: addon.name })),
      onError: toast.fail,
    })
  }

  async function onDelete(addon: AddonRow) {
    const message = t('dashboard.plans.confirmDelete', { name: addon.name })
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    deleteAddon.mutate(addon.id, {
      onSuccess: (result) =>
        result.deactivated
          ? toast.warning(t('dashboard.plans.soldDeactivated', { name: addon.name }))
          : toast.success(t('dashboard.plans.addonDeleted', { name: addon.name })),
      onError: toast.fail,
    })
  }

  return (
    <>
      <PageHead title={t('dashboard.plans.title')}>
        <Link className="btn btn--ghost" to="/dashboard/site">
          {t('dashboard.plans.siteSettings')}
        </Link>
      </PageHead>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>{t('dashboard.common.howItWorks')}</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          <Trans i18nKey="dashboard.plans.how" components={{ strong: <strong />, code: <code /> }} />
        </p>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          {t('dashboard.plans.keys')}{' '}
          {data?.featureKeys.map((key, index) => (
            <span key={key}>
              <code>{key}</code>
              {index < data.featureKeys.length - 1 && ' · '}
            </span>
          ))}
        </p>
      </div>

      <QueryState loading={isPending} error={isError} />
      {data && (
        <div className="grid split-layout">
          <div>
            <h2 style={{ fontSize: 18 }}>{t('dashboard.plans.addonsTitle', { n: data.addons.length })}</h2>
            <Table
              cards="lg"
              className="rows-table"
              head={[
                t('dashboard.plans.cols.addon'),
                t('dashboard.plans.cols.code'),
                t('dashboard.plans.cols.price'),
                t('dashboard.plans.cols.plans'),
                t('dashboard.plans.cols.status'),
                null,
              ]}
              empty={t('dashboard.plans.noAddons')}
              isEmpty={data.addons.length === 0}
            >
              {data.addons.map((addon) => (
                <tr key={addon.id}>
                  <td className="cell--title">
                    <strong>{addon.name}</strong>
                    {addon.description && <span className="muted cell-desc">{addon.description}</span>}
                  </td>
                  <td data-label={t('dashboard.plans.cols.code')}>
                    {addon.code ? <code>{addon.code}</code> : <span className="muted">{t('dashboard.plans.service')}</span>}
                  </td>
                  <td data-label={t('dashboard.plans.cols.price')} style={{ whiteSpace: 'nowrap' }}>
                    <strong>{addon.price}</strong> <small className="muted">{currency}</small>
                  </td>
                  <td className="cell--text" data-label={t('dashboard.plans.cols.plans')}>
                    {addon.plans.length > 0 ? (
                      <span style={{ fontSize: 12.5 }}>{addon.plans.map((plan) => plan.name).join('، ')}</span>
                    ) : (
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        {t('dashboard.plans.allPlans')}
                      </span>
                    )}
                  </td>
                  <td data-label={t('dashboard.plans.cols.status')}>
                    {addon.isActive ? (
                      <Pill kind="published">{t('dashboard.plans.active')}</Pill>
                    ) : (
                      <Pill kind="archived">{t('dashboard.plans.stopped')}</Pill>
                    )}
                  </td>
                  <td className="cell--actions">
                    <div className="row-actions">
                      <Link className="btn btn--ghost btn--sm" to={{ search: `?edit=${addon.id}` }}>
                        {t('dashboard.common.edit')}
                      </Link>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => onToggle(addon)}>
                        {addon.isActive ? t('dashboard.plans.stop') : t('dashboard.plans.enable')}
                      </button>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => void onDelete(addon)}>
                        {t('dashboard.common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>

            <h2 style={{ fontSize: 18, marginTop: 28 }}>{t('dashboard.plans.plansTitle')}</h2>
            {/* الفورمات بره الجدول عن قصد: ‎<form>‎ جوّه ‎<tbody>‎ مش HTML صالح — الحقول بتتربط بيها بـ‎form=‎ */}
            {data.plans.map((plan) => (
              <form key={plan.id} id={`plan-${plan.id}`} hidden onSubmit={(event) => onSavePlan(plan, event)} />
            ))}
            <Table
              cards="lg"
              className="rows-table"
              head={[
                t('dashboard.plans.cols.plan'),
                t('dashboard.plans.cols.price'),
                t('dashboard.plans.cols.features'),
                t('dashboard.plans.cols.status'),
                null,
              ]}
              empty={t('dashboard.plans.noPlans')}
              isEmpty={data.plans.length === 0}
            >
              {data.plans.map((plan) => (
                <PlanRowEditor
                  key={`${plan.id}|${plan.name}|${plan.price}|${plan.oldPrice}|${plan.isActive}`}
                  plan={plan}
                  currency={currency}
                  pending={savePlan.isPending}
                />
              ))}
            </Table>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {t('dashboard.plans.plansNote')}
            </p>
          </div>

          <aside className="card">
            <h2 style={{ fontSize: 17, marginTop: 0 }}>
              {editing ? t('dashboard.plans.editTitle', { name: editing.name }) : t('dashboard.plans.addTitle')}
            </h2>
            <form className="form" key={editing?.id ?? 'new'} onSubmit={onSubmit}>
              <ErrorList message={errors.formError} nonField />
              <TextField
                name="name"
                label={t('dashboard.plans.fields.name')}
                maxLength={120}
                required
                defaultValue={editing?.name}
                error={errors.fields.name}
              />
              <TextField
                name="nameEn"
                label={t('dashboard.plans.fields.nameEn')}
                maxLength={120}
                defaultValue={editing?.nameEn}
                error={errors.fields.nameEn}
              />
              <TextField
                name="code"
                label={t('dashboard.plans.fields.code')}
                placeholder="music / rsvp / gallery …"
                maxLength={40}
                defaultValue={editing?.code}
                help={t('dashboard.plans.codeHelp')}
                helpSmall
                error={errors.fields.code}
              />
              <TextField
                name="price"
                type="number"
                label={t('dashboard.plans.fields.price')}
                step="0.01"
                required
                defaultValue={editing?.priceValue ?? 0}
                error={errors.fields.price}
              />
              <TextField
                name="description"
                label={t('dashboard.plans.fields.description')}
                placeholder={t('dashboard.plans.descriptionPlaceholder')}
                maxLength={200}
                defaultValue={editing?.description}
                error={errors.fields.description}
              />
              <fieldset className="field field--group" id={planChecksId}>
                <legend>{t('dashboard.plans.fields.plans')}</legend>
                {data.planChoices.map((plan, index) => (
                  <label key={plan.id} className="check-row" htmlFor={`${planChecksId}-${index}`}>
                    <input
                      type="checkbox"
                      name="plans"
                      value={plan.id}
                      id={`${planChecksId}-${index}`}
                      defaultChecked={editing?.planIds.includes(plan.id)}
                    />
                    <span>{plan.name}</span>
                  </label>
                ))}
              </fieldset>
              <ErrorList message={errors.fields.plans} />
              <CheckField
                name="isActive"
                label={t('dashboard.plans.fields.isActive')}
                defaultChecked={editing ? editing.isActive : true}
              />
              <TextField
                name="sortOrder"
                type="number"
                label={t('dashboard.plans.fields.sortOrder')}
                min={0}
                required
                defaultValue={editing?.sortOrder ?? 0}
                error={errors.fields.sortOrder}
              />
              <button className="btn btn--gold btn--block" type="submit" disabled={saveAddon.isPending}>
                {editing ? t('dashboard.plans.saveEdit') : t('dashboard.plans.add')}
              </button>
              {editing && (
                <Link className="btn btn--ghost btn--block" to="/dashboard/plans" style={{ marginTop: 8 }}>
                  {t('dashboard.common.cancel')}
                </Link>
              )}
            </form>
          </aside>
        </div>
      )}
    </>
  )
}
