import type { FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { appPath } from '@/lib/appPath'

import { useCreateTemplate, useTemplatesList } from '../api'
import { FileField, MB, SelectField, TextAreaField, TextField, useFormErrors } from '../ui/forms'
import { useLabels } from '../ui/labels'
import { PageHead, usePageTitle } from '../ui/page'
import { useToast } from '../ui/Toast'

/** إنشاء قالب فارغ — بعده المحرر (‎templates/dashboard/template_create.html‎). */
export function TemplateNewPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const toast = useToast()
  const { data } = useTemplatesList()
  const create = useCreateTemplate()
  const navigate = useNavigate()
  const errors = useFormErrors()
  usePageTitle(t('dashboard.templateNew.pageTitle'))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const body = new FormData()
    for (const key of ['name', 'category', 'collection', 'slug', 'description', 'coverUrl'] as const) {
      body.set(key, String(values.get(key) ?? ''))
    }
    const cover = values.get('coverImage')
    if (cover instanceof File && cover.size > 0) body.set('coverImage', cover)

    errors.clear()
    create.mutate(body, {
      onSuccess: (created) => {
        navigate(appPath(created.editorUrl))
      },
      onError: (error) => {
        if (errors.fail(error)) toast.error(t('dashboard.templateNew.reviewData'))
        else toast.fail(error)
      },
    })
  }

  const fieldErrors = Object.entries(errors.fields)

  return (
    <>
      <PageHead title={t('dashboard.templateNew.title')}>
        <Link className="btn btn--ghost" to="/dashboard/templates">
          {t('dashboard.templateNew.back')}
        </Link>
      </PageHead>

      <form className="card" style={{ maxWidth: 860 }} onSubmit={onSubmit} encType="multipart/form-data">
        <h3 style={{ marginTop: 0 }}>{t('dashboard.templateNew.heading')}</h3>
        <p className="muted">
          <Trans i18nKey="dashboard.templateNew.intro" components={{ strong: <strong /> }} />
        </p>

        {(fieldErrors.length > 0 || errors.formError) && (
          <div className="alert alert--error" style={{ marginBottom: 18 }}>
            <strong>{t('dashboard.templateNew.reviewTitle')}</strong>
            {fieldErrors.map(([field, message]) => (
              <div key={field}>
                {t(`dashboard.templateNew.fields.${field}`, { defaultValue: field })}: {message}
              </div>
            ))}
            {errors.formError && <div>{errors.formError}</div>}
          </div>
        )}

        <div className="form form--2">
          <TextField
            name="name"
            label={t('dashboard.templateNew.fields.name')}
            required
            maxLength={120}
            error={errors.fields.name}
          />
          <SelectField
            name="category"
            label={t('dashboard.templateNew.fields.category')}
            defaultValue="wedding"
            error={errors.fields.category}
          >
            {data?.categories.map((category) => (
              <option key={category.value} value={category.value}>
                {labels.category(category.value, category.label)}
              </option>
            ))}
          </SelectField>
          <TextField
            name="collection"
            label={t('dashboard.templateNew.fields.collection')}
            defaultValue="Premium"
            maxLength={40}
            error={errors.fields.collection}
          />
          <TextField
            name="slug"
            label={t('dashboard.templateNew.fields.slug')}
            maxLength={140}
            help={t('dashboard.templateNew.slugHelp')}
            error={errors.fields.slug}
          />
          <TextAreaField
            className="span-2"
            name="description"
            label={t('dashboard.templateNew.fields.description')}
            rows={3}
            error={errors.fields.description}
          />
          <FileField
            name="coverImage"
            label={t('dashboard.templateNew.fields.coverImage')}
            accept="image/*"
            maxBytes={8 * MB}
            error={errors.fields.coverImage}
          />
          <TextField
            name="coverUrl"
            type="url"
            label={t('dashboard.templateNew.fields.coverUrl')}
            maxLength={200}
            error={errors.fields.coverUrl}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 24 }}>
          <button className="btn btn--gold" type="submit" disabled={create.isPending}>
            {t('dashboard.templateNew.submit')}
          </button>
          <Link className="btn btn--ghost" to="/dashboard/templates">
            {t('dashboard.common.cancel')}
          </Link>
        </div>
      </form>
    </>
  )
}
