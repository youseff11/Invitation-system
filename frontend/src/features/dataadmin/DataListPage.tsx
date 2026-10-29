import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'

import { PageHead, usePageTitle } from '@/features/dashboard/ui/page'
import { QueryState, Table } from '@/features/dashboard/ui/table'
import { useToast } from '@/features/dashboard/ui/Toast'

import { dataKeys, useDataList } from './api'
import { DeleteDialog } from './DeleteDialog'
import { CellView } from './Fields'
import './dataadmin.css'

/** قائمة جدول: بحث، فلاتر، ترتيب، صفحات، وحذف جماعي (زي صفحة التغيير في الأدمن). */
export function DataListPage() {
  const { t } = useTranslation()
  const { model = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const client = useQueryClient()
  const scope = `${model}?${params.toString()}`
  const [picked, setPicked] = useState<{ scope: string; ids: number[] }>({ scope, ids: [] })
  // التحديد بيتصفّر لوحده لما الجدول أو الفلاتر أو الصفحة تتغير
  const selected = picked.scope === scope ? picked.ids : []
  const setSelected = (next: number[] | ((now: number[]) => number[])) =>
    setPicked((now) => ({ scope, ids: typeof next === 'function' ? next(now.scope === scope ? now.ids : []) : next }))
  const [deleting, setDeleting] = useState<number[] | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? params.get('q') ?? ''

  const query = useMemo(() => Object.fromEntries(params.entries()), [params])
  const { data, isPending, isError } = useDataList(model, query)
  usePageTitle(data?.model.name ?? t('dataadmin.title'))

  // جدول بسجل واحد من غير إضافة (إعدادات الموقع): نفتحه على التعديل على طول
  if (data && data.total === 1 && !data.perms.add && !params.toString()) {
    return <Navigate replace to={`/dashboard/data/${model}/${data.rows[0].id}`} />
  }

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (resetPage) next.delete('page')
    setParams(next)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    update({ q: text.trim() })
    setDraft(null)
  }

  const sort = params.get('o') ?? ''
  const toggleSort = (name: string) => update({ o: sort === name ? `-${name}` : sort === `-${name}` ? null : name }, false)
  const rows = data?.rows ?? []
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id))
  const activeFilters = [...params.keys()].filter((key) => key.startsWith('f_') || key === 'q').length

  return (
    <>
      <PageHead title={data?.model.name ?? ''} subtitle={data ? t('dataadmin.total', { count: data.total }) : undefined}>
        <div className="da-head-actions">
          <Link className="btn btn--ghost btn--sm" to="/dashboard/data">
            ← {t('dataadmin.allTables')}
          </Link>
          {data?.perms.add && (
            <Link className="btn btn--gold btn--sm" to={`/dashboard/data/${model}/new`}>
              + {t('dataadmin.addNew', { name: data.model.singular })}
            </Link>
          )}
        </div>
      </PageHead>

      <form className="da-toolbar" onSubmit={submit} role="search">
        {data?.searchable && (
          <input
            type="search"
            value={text}
            placeholder={t('dataadmin.search')}
            aria-label={t('dataadmin.search')}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
        {data?.filters.map((filter) => (
          <select
            key={filter.name}
            aria-label={filter.label}
            value={params.get(`f_${filter.name}`) ?? ''}
            onChange={(event) => update({ [`f_${filter.name}`]: event.target.value })}
          >
            <option value="">
              {filter.label}: {t('dataadmin.all')}
            </option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}
        {data?.searchable && (
          <button className="btn btn--ghost btn--sm" type="submit">
            {t('dataadmin.searchBtn')}
          </button>
        )}
        {activeFilters > 0 && (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setParams(new URLSearchParams())}>
            {t('dataadmin.clearFilters')}
          </button>
        )}
      </form>

      {selected.length > 0 && data?.perms.delete && (
        <div className="da-bulk" role="status">
          <span>{t('dataadmin.selected', { count: selected.length })}</span>
          <button className="btn btn--ghost btn--danger btn--sm" type="button" onClick={() => setDeleting(selected)}>
            {t('dataadmin.deleteSelected')}
          </button>
        </div>
      )}

      <QueryState loading={isPending} error={isError} />
      {data && (
        <Table
          head={[
            data.perms.delete ? (
              <input
                key="all"
                type="checkbox"
                aria-label={t('dataadmin.selectAll')}
                checked={allSelected}
                onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])}
              />
            ) : null,
            ...data.columns.map((column) =>
              column.sortable ? (
                <button key={column.name} type="button" className="da-sort" onClick={() => toggleSort(column.name)}>
                  {column.label}
                  {sort === column.name ? ' ▲' : sort === `-${column.name}` ? ' ▼' : ''}
                </button>
              ) : (
                column.label
              ),
            ),
          ]}
          empty={t('dataadmin.empty')}
          isEmpty={rows.length === 0}
        >
          {rows.map((row) => (
            <tr key={row.id} className={selected.includes(row.id) ? 'is-selected' : undefined}>
              <td className="da-check-cell">
                {data.perms.delete && (
                  <input
                    type="checkbox"
                    aria-label={row.title}
                    checked={selected.includes(row.id)}
                    onChange={(event) =>
                      setSelected((now) => (event.target.checked ? [...now, row.id] : now.filter((id) => id !== row.id)))
                    }
                  />
                )}
              </td>
              {row.cells.map((cell, index) => (
                <td key={index}>
                  {index === 0 ? (
                    <Link className="da-row-link" to={`/dashboard/data/${model}/${row.id}`}>
                      <CellView cell={cell} />
                    </Link>
                  ) : (
                    <CellView cell={cell} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </Table>
      )}

      {data && data.pages > 1 && (
        <nav className="da-pager" aria-label={t('dataadmin.pages')}>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={data.page <= 1}
            onClick={() => update({ page: String(data.page - 1) }, false)}
          >
            {t('dataadmin.prev')}
          </button>
          <span>{t('dataadmin.pageOf', { page: data.page, pages: data.pages })}</span>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={data.page >= data.pages}
            onClick={() => update({ page: String(data.page + 1) }, false)}
          >
            {t('dataadmin.next')}
          </button>
        </nav>
      )}

      {deleting && (
        <DeleteDialog
          modelKey={model}
          ids={deleting}
          onClose={() => setDeleting(null)}
          onDone={(count) => {
            setDeleting(null)
            setSelected([])
            toast.success(t('dataadmin.deleted', { count }))
            // آخر صفحة اتفضّت: نرجع صفحة. غير كده القائمة بتتجاب من جديد
            if (data && rows.length === count && data.page > 1) update({ page: String(data.page - 1) }, false)
            void client.invalidateQueries({ queryKey: dataKeys.all })
          }}
        />
      )}
    </>
  )
}
