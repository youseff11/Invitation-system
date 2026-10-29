import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useLibrary } from '../api'
import type { ClipRow } from '../types'
import { useConfirm } from '../ui/ConfirmDialog'
import { CheckField, ErrorList, FileField, MB, TextField, useFormErrors } from '../ui/forms'
import { PageHead, Pill, usePageTitle } from '../ui/page'
import { QueryState } from '../ui/table'
import { useToast } from '../ui/Toast'

export type ClipLibraryKind = 'intros' | 'videos'

type Library = ReturnType<typeof useLibrary<ClipLibraryKind>>

/** معاينة الفيديو: أول فريم (أو الغلاف) وبالضغط يشتغل في مكانه. */
function ClipPreview({ clip }: { clip: ClipRow }) {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  if (!clip.url) {
    return <div className="clip-preview clip-preview--empty">{t('dashboard.clips.noPreview')}</div>
  }

  function play() {
    setPlaying(true)
    void video.current?.play().catch(() => undefined)
  }

  return (
    <div className="clip-preview">
      <video
        ref={video}
        src={playing ? clip.url : `${clip.url}#t=0.1`}
        poster={clip.posterUrl || undefined}
        controls={playing}
        preload="metadata"
        playsInline
        muted={!playing}
      />
      {!playing && (
        <button type="button" className="clip-play" aria-label={clip.name} onClick={play}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </button>
      )}
    </div>
  )
}

function ClipCard({ kind, clip, lib }: { kind: ClipLibraryKind; clip: ClipRow; lib: Library }) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(clip.name)

  function startRename() {
    setName(clip.name)
    setEditing(true)
  }

  function saveName(event?: FormEvent) {
    event?.preventDefault()
    const next = name.trim()
    if (!next || next === clip.name) return setEditing(false)
    lib.rename.mutate(
      { id: clip.id, name: next },
      {
        onSuccess: (row) => {
          setEditing(false)
          toast.success(t('dashboard.clips.renamed', { name: row.name }))
        },
        onError: toast.fail,
      },
    )
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') setEditing(false)
  }

  function onToggle() {
    lib.toggle.mutate(clip.id, {
      onSuccess: () => toast.success(t(`dashboard.${kind}.${clip.isActive ? 'hiddenDone' : 'shownDone'}`, { name: clip.name })),
      onError: toast.fail,
    })
  }

  async function onDelete() {
    const message = t(`dashboard.${kind}.confirmDelete`, { name: clip.name })
    if (!(await confirm({ message, danger: true, confirmLabel: t('dashboard.common.delete') }))) return
    lib.remove.mutate(clip.id, {
      onSuccess: () => toast.success(t(`dashboard.${kind}.deleted`, { name: clip.name })),
      onError: toast.fail,
    })
  }

  async function onMove() {
    const message = t('dashboard.videos.confirmMove', { name: clip.name })
    if (!(await confirm({ message, confirmLabel: t('dashboard.videos.moveToIntros') }))) return
    lib.moveToIntros.mutate(clip.id, {
      onSuccess: () => toast.success(t('dashboard.videos.moved', { name: clip.name })),
      onError: toast.fail,
    })
  }

  return (
    <article className={clip.isActive ? 'clip-card' : 'clip-card is-hidden'}>
      <ClipPreview clip={clip} />
      <div className="clip-body">
        {editing ? (
          <form className="clip-rename" onSubmit={saveName}>
            <input
              autoFocus
              value={name}
              maxLength={120}
              aria-label={t('dashboard.clips.nameLabel')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={onKey}
            />
            <button className="btn btn--gold btn--sm" type="submit" disabled={lib.rename.isPending}>
              {t('dashboard.clips.save')}
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(false)}>
              {t('dashboard.clips.cancel')}
            </button>
          </form>
        ) : (
          <h3 className="clip-name">{clip.name}</h3>
        )}
        <div className="clip-meta">
          {clip.isActive ? (
            <Pill kind="published">{t('dashboard.intros.available')}</Pill>
          ) : (
            <Pill kind="archived">{t('dashboard.intros.hidden')}</Pill>
          )}
          {clip.secondsLabel && (
            <span className="muted nums">
              {clip.secondsLabel} {t('dashboard.intros.secondsUnit')}
            </span>
          )}
        </div>
        {clip.note && <p className="muted clip-note">{clip.note}</p>}
        <div className="toolbar clip-actions">
          {!editing && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={startRename}>
              {t('dashboard.clips.rename')}
            </button>
          )}
          {kind === 'videos' && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void onMove()}>
              {t('dashboard.videos.moveToIntros')}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" type="button" onClick={onToggle}>
            {clip.isActive ? t('dashboard.common.hide') : t('dashboard.common.show')}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void onDelete()}>
            {t('dashboard.common.delete')}
          </button>
        </div>
      </div>
    </article>
  )
}

/** مكتبتا الفيديو (الافتتاحيات والفيديوهات العادية): نفس الصفحة، كروت معاينة بدل الجدول. */
export function ClipLibraryPage({ kind }: { kind: ClipLibraryKind }) {
  const { t } = useTranslation()
  const toast = useToast()
  const lib = useLibrary(kind)
  const { list, create } = lib
  const errors = useFormErrors()
  usePageTitle(t(`dashboard.${kind}.pageTitle`))

  const clips = list.data?.results ?? []

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    errors.clear()
    create.mutate(new FormData(form), {
      onSuccess: (clip) => {
        toast.success(t(`dashboard.${kind}.added`, { name: clip.name }))
        form.reset()
      },
      onError: (error) => {
        if (errors.fail(error)) toast.error(t('dashboard.intros.reviewData'))
        else toast.fail(error)
      },
    })
  }

  return (
    <>
      <PageHead title={t(`dashboard.${kind}.title`)}>
        <Link className="btn btn--ghost" to="/dashboard/invitations">
          {t('dashboard.common.backToInvitations')}
        </Link>
      </PageHead>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>{t('dashboard.common.howItWorks')}</h2>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13.5 }}>
          <Trans i18nKey={`dashboard.${kind}.how`} components={{ strong: <strong /> }} />
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t(`dashboard.${kind}.howNote`)}
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)', alignItems: 'start' }}>
        <div>
          <h2 style={{ fontSize: 18 }}>{t(`dashboard.${kind}.listTitle`, { n: clips.length })}</h2>
          <QueryState loading={list.isPending} error={list.isError} />
          {list.data &&
            (clips.length === 0 ? (
              <p className="muted">{t(`dashboard.${kind}.none`)}</p>
            ) : (
              <div className="clip-grid">
                {clips.map((clip) => (
                  <ClipCard key={clip.id} kind={kind} clip={clip} lib={lib} />
                ))}
              </div>
            ))}
        </div>

        <aside className="card">
          <h2 style={{ fontSize: 17, marginTop: 0 }}>{t(`dashboard.${kind}.addTitle`)}</h2>
          <form className="form" onSubmit={onSubmit} encType="multipart/form-data">
            <ErrorList message={errors.formError} nonField />
            <TextField
              name="name"
              label={t('dashboard.intros.fields.name')}
              maxLength={120}
              required
              error={errors.fields.name}
            />
            <FileField
              name="file"
              label={t('dashboard.intros.fields.file')}
              accept="video/mp4,video/webm"
              maxBytes={40 * MB}
              error={errors.fields.file}
            />
            <FileField
              name="poster"
              label={t('dashboard.intros.fields.poster')}
              accept="image/*"
              maxBytes={8 * MB}
              error={errors.fields.poster}
            />
            <TextField
              name="externalUrl"
              type="url"
              label={t('dashboard.intros.fields.externalUrl')}
              placeholder="https://.../intro.mp4"
              maxLength={200}
              help={t('dashboard.intros.externalUrlHelp')}
              helpSmall
              error={errors.fields.externalUrl}
            />
            <TextField
              name="note"
              label={t('dashboard.intros.fields.note')}
              maxLength={200}
              error={errors.fields.note}
            />
            <CheckField name="isActive" label={t('dashboard.intros.fields.isActive')} defaultChecked />
            <TextField
              name="order"
              type="number"
              label={t('dashboard.intros.fields.order')}
              defaultValue={0}
              min={0}
              required
              error={errors.fields.order}
            />
            <button className="btn btn--gold btn--block" type="submit" disabled={create.isPending}>
              {t('dashboard.common.saveToLibrary')}
            </button>
          </form>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {t('dashboard.intros.footnote')}
          </p>
        </aside>
      </div>
    </>
  )
}
