import { useId } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useLibrary } from '../api'
import { ErrorList, Field, FileField, MB, SelectField, TextField, useFormErrors } from '../ui/forms'
import { useLabels } from '../ui/labels'
import { LibraryActions } from '../ui/LibraryActions'
import { PageHead, usePageTitle } from '../ui/page'
import { QueryState, Table } from '../ui/table'
import { useToast } from '../ui/Toast'

/** مكتبة الخطوط (‎templates/dashboard/fonts.html‎). */
export function FontsPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const toast = useToast()
  const { list, create, toggle, remove } = useLibrary('fonts')
  const errors = useFormErrors()
  const activeId = useId()
  usePageTitle(t('dashboard.fonts.pageTitle'))

  const fonts = list.data?.results ?? []

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    errors.clear()
    create.mutate(new FormData(form), {
      onSuccess: (font) => {
        toast.success(t('dashboard.fonts.added', { name: font.name }))
        form.reset()
      },
      onError: (error) => {
        if (errors.fail(error)) toast.error(t('dashboard.fonts.reviewData'))
        else toast.fail(error)
      },
    })
  }

  return (
    <>
      <PageHead title={t('dashboard.fonts.title')} subtitle={t('dashboard.fonts.subtitle')}>
        <Link className="btn btn--ghost" to="/dashboard/invitations">
          {t('dashboard.common.backToInvitations')}
        </Link>
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(300px,1fr)', alignItems: 'start' }}>
        <section className="card">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>{t('dashboard.fonts.listTitle', { n: fonts.length })}</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('dashboard.fonts.activeNote')}
          </p>
          <QueryState loading={list.isPending} error={list.isError} />
          {list.data && (
            <Table
              head={[
                t('dashboard.fonts.cols.name'),
                t('dashboard.fonts.cols.preview'),
                t('dashboard.fonts.cols.source'),
                t('dashboard.fonts.cols.status'),
                null,
              ]}
              empty={t('dashboard.fonts.none')}
              isEmpty={fonts.length === 0}
            >
              {fonts.map((font) => (
                <tr key={font.id}>
                  <td>
                    <strong>{font.name}</strong>
                    {font.nameEn && (
                      <>
                        <br />
                        <span className="muted">{font.nameEn}</span>
                      </>
                    )}
                    <br />
                    <small className="muted">
                      {font.family} · {font.weight} · {labels.fontStyle(font.style, font.styleLabel)}
                    </small>
                  </td>
                  <td style={{ fontFamily: `'${font.family}'`, fontSize: 22 }}>{t('dashboard.fonts.sample')}</td>
                  <td>
                    {font.url ? (
                      <a href={font.url} target="_blank" rel="noopener">
                        {t('dashboard.fonts.openFile')}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {font.isActive ? (
                      <span className="status status--ok">{t('dashboard.fonts.available')}</span>
                    ) : (
                      <span className="status">{t('dashboard.fonts.hidden')}</span>
                    )}
                  </td>
                  <td>
                    <LibraryActions kind="fonts" row={font} toggle={toggle} remove={remove} gap={5} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        <aside className="card">
          <h2 style={{ fontSize: 17, marginTop: 0 }}>{t('dashboard.fonts.addTitle')}</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('dashboard.fonts.addNote')}
          </p>
          <form className="form" onSubmit={onSubmit} encType="multipart/form-data">
            <ErrorList message={errors.formError} nonField />
            <TextField
              name="name"
              label={t('dashboard.fonts.fields.name')}
              maxLength={120}
              required
              error={errors.fields.name}
            />
            <TextField
              name="nameEn"
              label={t('dashboard.fonts.fields.nameEn')}
              maxLength={120}
              error={errors.fields.nameEn}
            />
            <TextField
              name="family"
              label={t('dashboard.fonts.fields.family')}
              maxLength={120}
              required
              help={t('dashboard.fonts.familyHelp')}
              error={errors.fields.family}
            />
            <FileField
              name="file"
              label={t('dashboard.fonts.fields.file')}
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              maxBytes={8 * MB}
              error={errors.fields.file}
            />
            <TextField
              name="externalUrl"
              type="url"
              label={t('dashboard.fonts.fields.externalUrl')}
              placeholder="https://.../font.woff2"
              maxLength={200}
              help={t('dashboard.fonts.externalUrlHelp')}
              error={errors.fields.externalUrl}
            />
            <TextField
              name="weight"
              type="number"
              label={t('dashboard.fonts.fields.weight')}
              defaultValue={400}
              min={0}
              max={900}
              step={100}
              required
              error={errors.fields.weight}
            />
            <SelectField
              name="style"
              label={t('dashboard.fonts.fields.style')}
              defaultValue="normal"
              error={errors.fields.style}
            >
              <option value="normal">{labels.fontStyle('normal', 'عادي')}</option>
              <option value="italic">{labels.fontStyle('italic', 'مائل')}</option>
            </SelectField>
            <Field id={activeId} label={t('dashboard.fonts.fields.isActive')} error={errors.fields.isActive}>
              <input id={activeId} type="checkbox" name="isActive" defaultChecked />
            </Field>
            <TextField
              name="order"
              type="number"
              label={t('dashboard.fonts.fields.order')}
              defaultValue={0}
              min={0}
              required
              error={errors.fields.order}
            />
            <button className="btn btn--gold btn--block" type="submit" disabled={create.isPending}>
              {t('dashboard.fonts.submit')}
            </button>
          </form>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {t('dashboard.fonts.footnote')}
          </p>
        </aside>
      </div>
    </>
  )
}
