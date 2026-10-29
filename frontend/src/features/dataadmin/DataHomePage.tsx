import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useSite } from '@/api/hooks'
import type { Lang } from '@/api/types'
import { usePageTitle } from '@/features/dashboard/ui/page'
import { QueryState } from '@/features/dashboard/ui/table'

import { useCatalog } from './api'
import { ModelIcon } from './icons'
import { SiteIconControl } from './SiteIconControl'
import { SiteLogoControl } from './SiteLogoControl'
import './dataadmin.css'

/** إدارة البيانات: كل جداول الموقع (بديل صفحة ‎/admin/‎ الرئيسية). */
export function DataHomePage() {
  const { t, i18n } = useTranslation()
  const { data, isPending, isError } = useCatalog()
  const { data: site } = useSite()
  const [filter, setFilter] = useState('')
  usePageTitle(t('dataadmin.title'))

  const all = data?.apps.flatMap((app) => app.models) ?? []
  const recordCount = all.reduce((sum, model) => sum + model.count, 0)
  const needle = filter.trim().toLowerCase()
  return (
    <>
      <header className="da-banner">
        <span className="da-banner-logo" role="img" aria-label={site?.name[(i18n.language as Lang) ?? 'ar'] ?? ''} />
        <div className="da-banner-text">
          <h1>{t('dataadmin.title')}</h1>
          <p>{t('dataadmin.subtitle')}</p>
          <SiteIconControl />
          <SiteLogoControl />
        </div>
        <dl className="da-banner-stats">
          <div>
            <dt>{t('dataadmin.stats.tables')}</dt>
            <dd>{all.length}</dd>
          </div>
          <div>
            <dt>{t('dataadmin.stats.records')}</dt>
            <dd>{recordCount.toLocaleString(i18n.language)}</dd>
          </div>
        </dl>
        <input
          className="da-filter"
          type="search"
          value={filter}
          placeholder={t('dataadmin.filterTables')}
          aria-label={t('dataadmin.filterTables')}
          onChange={(event) => setFilter(event.target.value)}
        />
      </header>
      <QueryState loading={isPending} error={isError} />
      {data?.apps.map((app) => {
        const models = app.models.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.singular.toLowerCase().includes(needle))
        if (models.length === 0) return null
        return (
          <section key={app.app} className="da-app">
            <h2>
              {t(`dataadmin.apps.${app.app}`, { defaultValue: app.label })}
              <span>{models.length}</span>
            </h2>
            <div className="da-grid">
              {models.map((model) => (
                <article key={model.key} className="da-model card">
                  <Link className="da-model-main" to={`/dashboard/data/${model.key}`}>
                    <span className="da-model-icon">
                      <ModelIcon modelKey={model.key} />
                    </span>
                    <span className="da-model-text">
                      <strong>{model.name}</strong>
                      <span className="da-count">{t('dataadmin.records', { count: model.count })}</span>
                    </span>
                  </Link>
                  {model.perms.add && !model.single && (
                    <Link
                      className="da-add"
                      to={`/dashboard/data/${model.key}/new`}
                      title={`${t('dataadmin.add')} — ${model.name}`}
                      aria-label={`${t('dataadmin.add')} — ${model.name}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>
        )
      })}
      {data && data.apps.length === 0 && <p className="empty">{t('dataadmin.noTables')}</p>}
    </>
  )
}
