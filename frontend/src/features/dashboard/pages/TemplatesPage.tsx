import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { appPath } from '@/lib/appPath'

import { useDeleteTemplate, useImportTemplate, useTemplatesList, useToggleTemplate } from '../api'
import type { TemplateRow } from '../types'
import { useConfirm } from '../ui/ConfirmDialog'
import { useLabels } from '../ui/labels'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState } from '../ui/table'
import { useToast } from '../ui/Toast'

/** قايمة «الإجراءات» بتاعة كارت القالب — بتتقفل بالضغط بره أو Escape أو اختيار رابط. */
function TemplateActionMenu({ template }: { template: TemplateRow }) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const toggle = useToggleTemplate()
  const remove = useDeleteTemplate()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function onToggle() {
    toggle.mutate(template.id, {
      onSuccess: (result) =>
        toast.success(
          t(result.isActive ? 'dashboard.templates.shown' : 'dashboard.templates.hiddenDone', {
            name: template.name,
          }),
        ),
      onError: toast.fail,
    })
    setOpen(false)
  }

  async function onDelete() {
    setOpen(false)
    const message = t('dashboard.templates.confirmDelete', { name: template.name })
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    remove.mutate(template.id, {
      onSuccess: () => toast.success(t('dashboard.templates.deleted', { name: template.name })),
      onError: toast.fail,
    })
  }

  return (
    <div className="tpl-action-menu" ref={root}>
      <button
        className="btn btn--ghost btn--sm tpl-action-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯ <span>{t('dashboard.templates.actions')}</span>
      </button>
      <div
        className="tpl-action-panel"
        id={panelId}
        hidden={!open}
        role="menu"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false)
        }}
      >
        <Link to={appPath(template.editorUrl)} role="menuitem">
          {t('dashboard.templates.edit')}
        </Link>
        <a href={template.adminUrl} role="menuitem">
          {t('dashboard.templates.editData')}
        </a>
        <a href={template.previewUrl} target="_blank" rel="noopener" role="menuitem">
          {t('dashboard.templates.preview')}
        </a>
        <button type="button" role="menuitem" onClick={onToggle}>
          {template.isActive ? t('dashboard.templates.hide') : t('dashboard.templates.show')}
        </button>
        {!template.uses && (
          <button type="button" role="menuitem" onClick={() => void onDelete()}>
            {t('dashboard.templates.delete')}
          </button>
        )}
      </div>
    </div>
  )
}

/** مكتبة القوالب + استيراد HTML/ZIP (‎templates/dashboard/templates.html‎). */
export function TemplatesPage() {
  const { t } = useTranslation()
  const labels = useLabels()
  const toast = useToast()
  const { data, isPending, isError } = useTemplatesList()
  const importer = useImportTemplate()
  const [params, setParams] = useSearchParams()
  usePageTitle(t('dashboard.templates.pageTitle'))

  const results = data?.results ?? []
  const visibleCount = results.filter((template) => template.isActive).length
  const hiddenCount = results.length - visibleCount
  const view = params.get('show') === 'visible' || params.get('show') === 'hidden' ? params.get('show') : 'all'
  const shown =
    view === 'visible'
      ? results.filter((template) => template.isActive)
      : view === 'hidden'
        ? results.filter((template) => !template.isActive)
        : results

  function setView(value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('show')
    else next.set('show', value)
    setParams(next, { replace: true })
  }

  function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const body = new FormData()
    body.set('file', values.get('file') ?? '')
    body.set('name', String(values.get('name') ?? '').trim())
    body.set('category', String(values.get('category') ?? ''))
    importer.mutate(body, {
      onSuccess: (result) => {
        let message = t('dashboard.templates.imported', {
          name: result.name,
          blocks: result.blocks,
          chars: result.chars,
        })
        if (result.tracks) message += ` ${t('dashboard.templates.importedTracks', { n: result.tracks })}`
        if (result.scripts) message += ` ${t('dashboard.templates.importedScripts', { n: result.scripts })}`
        toast.success(`${message} ${t('dashboard.templates.importedOpen')}`)
        // ملف صغير بيعدّي، بس ننبّه عشان يراجع المعاينة
        if (result.thinContent) toast.warning(t('dashboard.templates.thinContent', { chars: result.chars }))
        form.reset()
      },
      onError: toast.fail,
    })
  }

  return (
    <>
      <PageHead title={t('dashboard.templates.title')}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="btn btn--gold" to="/dashboard/templates/new">
            {t('dashboard.templates.create')}
          </Link>
          <Link className="btn btn--ghost" to="/dashboard/invitations/new">
            {t('dashboard.common.newInvitation')}
          </Link>
        </div>
      </PageHead>

      <div className="card" style={{ marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>{t('dashboard.templates.howTitle')}</h3>
        <p className="muted" style={{ margin: 0 }}>
          <Trans i18nKey="dashboard.templates.howBody" components={{ strong: <strong /> }} />
        </p>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>{t('dashboard.templates.importTitle')}</h3>
        <p className="muted" style={{ fontSize: 13.5 }}>
          <Trans i18nKey="dashboard.templates.importBody" components={{ code: <code /> }} />
        </p>
        <p
          className="muted"
          style={{ fontSize: 13, borderInlineStart: '3px solid var(--accent)', paddingInlineStart: 10 }}
        >
          <Trans i18nKey="dashboard.templates.importLimits" components={{ strong: <strong /> }} />
        </p>
        <form className="toolbar" onSubmit={onImport}>
          <input type="file" name="file" required accept=".html,.htm,.zip,text/html,application/zip" />
          <input
            type="text"
            name="name"
            placeholder={t('dashboard.templates.importName')}
            maxLength={120}
          />
          <select name="category" defaultValue="none">
            {data?.categories.map((category) => (
              <option key={category.value} value={category.value}>
                {labels.category(category.value, category.label)}
              </option>
            ))}
          </select>
          <button className="btn btn--gold btn--sm" type="submit" disabled={importer.isPending}>
            {importer.isPending ? t('dashboard.templates.importing') : t('dashboard.templates.import')}
          </button>
        </form>
      </div>

      <QueryState loading={isPending} error={isError} />
      {data && (
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <select
            aria-label={t('dashboard.templates.filter.label')}
            value={view ?? 'all'}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="all">{t('dashboard.templates.filter.all', { n: results.length })}</option>
            <option value="visible">{t('dashboard.templates.filter.visible', { n: visibleCount })}</option>
            <option value="hidden">{t('dashboard.templates.filter.hidden', { n: hiddenCount })}</option>
          </select>
        </div>
      )}
      {data && (
        <div className="grid grid--4">
          {shown.map((template) => (
            <article className="tpl-card" key={template.id}>
              <div
                className="tpl-cover"
                style={template.cover ? { backgroundImage: `url('${template.cover}')` } : undefined}
              >
                {!template.cover && template.name.slice(0, 1)}
              </div>
              <div className="tpl-body">
                <h3>{template.name}</h3>
                <span className="tpl-meta">
                  {template.category !== 'none' && `${labels.category(template.category, template.categoryLabel)} · `}
                  {labels.source(template.source, template.sourceLabel)} ·{' '}
                  {t('dashboard.templates.meta', { blocks: template.blocks, uses: template.uses })}
                </span>
                {!template.isActive && <Pill kind="archived">{t('dashboard.common.hidden')}</Pill>}
                {template.blocks === 0 && <Pill kind="archived">{t('dashboard.templates.empty')}</Pill>}
                <div className="tpl-actions">
                  <TemplateActionMenu template={template} />
                </div>
              </div>
            </article>
          ))}
          {shown.length === 0 && (
            <p className="empty">
              {t(results.length === 0 ? 'dashboard.templates.none' : 'dashboard.templates.noneFiltered')}
            </p>
          )}
        </div>
      )}
    </>
  )
}
