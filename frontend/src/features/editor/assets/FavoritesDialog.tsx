import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BlockSpec, DocBlock, EditorSchema, FavoriteRow } from '../types'
import { useEditorUi } from '../ui'
import { createFavorite, deleteFavorite, fetchFavorites } from './api'
import { addFavoriteToDocument } from './favorites'
import { errorText } from './errors'
import { Modal } from './Modal'

const KEY = ['editor', 'favorites']

/** مكتبة المفضلة (مشتركة بين كل الدعوات والقوالب) — بتتجاب وقت الفتح بس لأنها تقيلة (مئات الكيلوبايت). */
export function FavoritesDialog({ schema, onClose }: { schema: EditorSchema; onClose: () => void }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const client = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: fetchFavorites, staleTime: 0, gcTime: 60_000 })
  const [removing, setRemoving] = useState<number | null>(null)
  const rows = query.data?.favorites ?? []

  const use = (favorite: FavoriteRow) => {
    const result = addFavoriteToDocument(favorite, schema)
    if (result === 'added') {
      ui.toast(t('editorAssets.favorites.added'), 'ok')
      onClose()
    } else {
      ui.toast(t(result === 'singleton' ? 'editorAssets.favorites.exists' : 'editorAssets.favorites.invalid'), 'error')
    }
  }

  const remove = async (favorite: FavoriteRow) => {
    if (!(await ui.confirm(t('editorAssets.favorites.confirmDelete'), { danger: true }))) return
    setRemoving(favorite.id)
    try {
      await deleteFavorite(favorite.id)
      client.setQueryData<{ favorites: FavoriteRow[] }>(KEY, (data) => ({
        favorites: (data?.favorites ?? []).filter((f) => f.id !== favorite.id),
      }))
      ui.toast(t('editorAssets.favorites.deleted'), 'ok')
    } catch (error) {
      ui.toast(errorText(error, t, 'editorAssets.errors.favoriteDelete'), 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Modal label={t('editorAssets.favorites.title')} onClose={onClose}>
      <h3>{t('editorAssets.favorites.title')}</h3>
      <p>{t('editorAssets.favorites.hint')}</p>
      <div className="ed-favorites">
        {query.isPending && <p className="ed-empty">{t('editorAssets.favorites.loading')}</p>}
        {query.isError && (
          <div className="ed-empty">
            <p>{errorText(query.error, t, 'editorAssets.errors.favoritesLoad')}</p>
            <button type="button" className="ed-btn ed-btn--sm" onClick={() => void query.refetch()}>
              {t('editorAssets.retry')}
            </button>
          </div>
        )}
        {query.isSuccess && rows.length === 0 && <p className="ed-empty">{t('editorAssets.favorites.empty')}</p>}
        {rows.map((favorite) => (
          <div className="ed-favorite-row" key={favorite.id}>
            <div className="ed-favorite-info">
              <strong>{favorite.name}</strong>
              <small className="ed-hint">{schema.blocks[favorite.blockType]?.label ?? favorite.blockType}</small>
            </div>
            <button type="button" className="ed-btn ed-btn--sm ed-btn--primary" onClick={() => use(favorite)}>
              {t('editorAssets.favorites.use')}
            </button>
            <button type="button" className="ed-btn ed-btn--sm" disabled={removing === favorite.id} onClick={() => void remove(favorite)}>
              {t('editorAssets.favorites.delete')}
            </button>
          </div>
        ))}
      </div>
      <div className="ed-modal-actions">
        <button type="button" className="ed-btn" onClick={onClose}>
          {t('editorAssets.close')}
        </button>
      </div>
    </Modal>
  )
}

/** زر «★ المفضلة» في تبويب الأقسام. */
export function FavoritesButton({ schema }: { schema: EditorSchema }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ed-btn ed-btn--sm" onClick={() => setOpen(true)}>
        {t('editorAssets.favorites.open')}
      </button>
      {open && <FavoritesDialog schema={schema} onClose={() => setOpen(false)} />}
    </>
  )
}

/** زر «☆ حفظ كمفضلة» في رأس الـinspector + نافذة صغيرة للاسم (بدل ‎window.prompt‎ القديم). */
export function SaveFavoriteButton({ block, spec }: { block: DocBlock; spec: BlockSpec }) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => !busy && setOpen(false)
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await createFavorite(trimmed, block)
      void client.invalidateQueries({ queryKey: KEY })
      ui.toast(t('editorAssets.favorites.saved'), 'ok')
      setOpen(false)
    } catch (error) {
      ui.toast(errorText(error, t, 'editorAssets.errors.favoriteSave'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="ed-btn ed-btn--sm"
        onClick={() => {
          setName(block.label || spec.label)
          setOpen(true)
        }}
      >
        {t('editorAssets.favorites.save')}
      </button>
      {open && (
        <Modal label={t('editorAssets.favorites.saveTitle')} onClose={close}>
          <h3>{t('editorAssets.favorites.saveTitle')}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="ed-field">
              <label htmlFor="ed-favorite-name">
                <span>{t('editorAssets.favorites.nameLabel')}</span>
              </label>
              <input
                id="ed-favorite-name"
                className="ed-input"
                type="text"
                maxLength={120}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="ed-modal-actions">
              <button type="button" className="ed-btn" disabled={busy} onClick={close}>
                {t('editorAssets.cancel')}
              </button>
              <button type="submit" className="ed-btn ed-btn--primary" disabled={busy || !name.trim()}>
                {t('editorAssets.favorites.saveConfirm')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
