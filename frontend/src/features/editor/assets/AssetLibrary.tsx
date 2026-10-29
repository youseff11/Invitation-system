import { useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'

import { useEditor } from '../store'
import type { AssetKind, AssetRow, IntroRow, MusicRow } from '../types'
import { useEditorUi } from '../ui'
import { bulkDeleteAssets, deleteAsset, fetchAssets, uploadAsset, type DeletableKind } from './api'
import { errorText } from './errors'
import { Modal } from './Modal'
import { cssUrl, realThumb } from './util'
import { makeClientVideoThumbnail, waitForFrame } from './video'

/** اللي بيرجع للحقل مع الرابط: غلاف الفيديو (بيضبط ‎intro_poster‎ لما الحقل يكون فيديو الافتتاحية). */
export interface PickMeta {
  poster?: string
  thumb?: string
}
export type PickHandler = (url: string, meta: PickMeta) => void

const ACCEPT: Record<AssetKind, string> = {
  image: 'image/*',
  video: 'video/mp4,video/webm,video/*',
  audio: 'audio/*',
}

type UsageFilter = 'all' | 'used' | 'unused'

interface Upload {
  key: number
  name: string
  progress: number
  error: string
}

// ---------------------------------------------------------------- مكتبة مشتركة (موسيقى / فيديوهات / افتتاحيات)
type LibraryItem = (MusicRow | IntroRow) & { poster?: string; seconds?: number }

function AudioRow({ item, onPick }: { item: LibraryItem; onPick: PickHandler }) {
  return (
    <div className="ed-track">
      <button type="button" className="ed-track-pick" title={item.note || item.name} onClick={() => onPick(item.url, {})}>
        {item.name}
      </button>
      <audio src={item.url} controls preload="none" />
    </div>
  )
}

function SharedAudio({ onPick }: { onPick: PickHandler }) {
  const { t } = useTranslation()
  const items = useEditor((s) => s.lib.music) as LibraryItem[]
  if (!items.length) return null
  return (
    <div className="ed-lib">
      <p className="ed-lib-label">{t('editorAssets.audio.shared')}</p>
      {items.map((item) => (
        <AudioRow key={item.id} item={item} onPick={onPick} />
      ))}
      <p className="ed-lib-label">{t('editorAssets.ownOnly')}</p>
    </div>
  )
}

/** فيديو من مكتبة مشتركة: معاينة أول فريم (أو الغلاف) واسم. */
function VideoCard({ item, onPick }: { item: IntroRow; onPick: PickHandler }) {
  const video = useRef<HTMLVideoElement>(null)
  const [busy, setBusy] = useState(false)

  const choose = async () => {
    // لو الفيديو مالوش غلاف محفوظ: نخلّي أول فريم هو الغلاف (بيتعرض ملء الشاشة)
    setBusy(true)
    const poster = item.poster || (video.current ? await waitForFrame(video.current) : '')
    setBusy(false)
    onPick(item.url, { poster, thumb: poster })
  }

  return (
    <div className="ed-asset-wrap">
      <button
        type="button"
        className="ed-asset ed-asset--file ed-asset--video-preview"
        title={item.note || item.name}
        disabled={busy}
        onClick={() => void choose()}
      >
        <video
          ref={video}
          src={`${item.url}#t=0.01`}
          poster={item.poster || undefined}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          disablePictureInPicture
        />
        <span className="ed-asset-name">
          {item.name}
          {item.seconds ? ` · ${Math.round(item.seconds)}s` : ''}
        </span>
      </button>
    </div>
  )
}

type VideoSource = 'videos' | 'intros' | 'mine'

/** أول شاشة في مكتبة الفيديو: «تجيب الفيديو منين؟» */
function SourceChooser({ onChoose }: { onChoose: (source: VideoSource) => void }) {
  const { t } = useTranslation()
  const videos = useEditor((s) => s.lib.videos)
  const intros = useEditor((s) => s.lib.intros)
  const options: { source: VideoSource; count?: number }[] = [
    { source: 'videos', count: videos.length },
    { source: 'intros', count: intros.length },
    { source: 'mine' },
  ]
  return (
    <div className="ed-source" role="group" aria-label={t('editorAssets.source.ask')}>
      <p className="ed-source-ask">{t('editorAssets.source.ask')}</p>
      <div className="ed-source-grid">
        {options.map(({ source, count }) => (
          <button key={source} type="button" className="ed-source-card" onClick={() => onChoose(source)}>
            <strong>{t(`editorAssets.source.${source}`)}</strong>
            <small>{t(`editorAssets.source.${source}Hint`)}</small>
            {count !== undefined && <span className="ed-source-count">{count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** معاينات فيديوهات مكتبة مشتركة (الفيديوهات أو الافتتاحيات). */
function SharedVideos({ source, onPick }: { source: 'videos' | 'intros'; onPick: PickHandler }) {
  const { t } = useTranslation()
  const items = useEditor((s) => s.lib[source])
  if (!items.length) return <p className="ed-empty">{t(`editorAssets.source.${source}Empty`)}</p>
  return (
    <div className="ed-assets ed-assets--roomy">
      {items.map((item) => (
        <VideoCard key={item.id} item={item} onPick={onPick} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- بطاقة أصل
interface TileProps {
  asset: AssetRow
  checked: boolean
  deleting: boolean
  onToggle: (id: number) => void
  onPick: (asset: AssetRow) => void
  onDelete: (asset: AssetRow) => void
}

function AssetTile({ asset, checked, deleting, onToggle, onPick, onDelete }: TileProps) {
  const { t } = useTranslation()
  const thumb = realThumb(asset)
  const classes = ['ed-asset']
  let style: CSSProperties | undefined
  let inner = null
  if (asset.kind === 'image') {
    style = cssUrl(asset.thumb || asset.url)
  } else if (asset.kind === 'video' && thumb) {
    classes.push('ed-asset--video-thumb')
    style = cssUrl(thumb)
    inner = <span className="ed-asset-name">{asset.name}</span>
  } else if (asset.kind === 'video') {
    // فيديو قديم من غير مصغّرة: المتصفح بيعرض أول فريم
    classes.push('ed-asset--file', 'ed-asset--video-preview')
    inner = (
      <>
        <video src={`${asset.url}#t=0.01`} muted playsInline preload="metadata" aria-hidden="true" disablePictureInPicture />
        <span className="ed-asset-name">{asset.name}</span>
      </>
    )
  } else {
    classes.push('ed-asset--file')
    inner = (
      <>
        <span className="ed-asset-ico">♪</span>
        <span className="ed-asset-name">{asset.name}</span>
      </>
    )
  }
  const deletable = asset.kind !== 'audio'

  return (
    <div className={`ed-asset-wrap${checked ? ' is-selected' : ''}`} data-asset-id={asset.id}>
      <button type="button" className={classes.join(' ')} style={style} title={asset.name} onClick={() => onPick(asset)}>
        {inner}
      </button>
      {asset.used && (
        <span className="ed-asset-used" title={t('editorAssets.usedHint')}>
          {t('editorAssets.used')}
        </span>
      )}
      {deletable && (
        <input
          type="checkbox"
          className="ed-asset-check"
          checked={checked}
          disabled={asset.used}
          title={t('editorAssets.selectForDelete')}
          aria-label={t('editorAssets.select', { name: asset.name })}
          onChange={() => onToggle(asset.id)}
        />
      )}
      {deletable && !asset.used && (
        <button
          type="button"
          className="ed-asset-delete"
          disabled={deleting}
          title={t(`editorAssets.${asset.kind}.deleteOne`)}
          aria-label={t(`editorAssets.${asset.kind}.deleteOne`)}
          onClick={() => onDelete(asset)}
        >
          ×
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- النافذة
interface Props {
  kind: AssetKind
  /** لما النافذة بتتفتح من حقل: الاختيار (أو أول رفع ناجح) بيرجع الرابط ويقفل النافذة */
  onPick?: PickHandler
  onClose: () => void
}

/** مكتبة الأصول: شبكة بفلتر الاستخدام، رفع بتقدّم، اختيار متعدد وحذف جماعي، ومكتبات الموسيقى/الفيديوهات/الافتتاحيات المشتركة. */
export function AssetLibrary({ kind, onPick, onClose }: Props) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const mode = useEditor((s) => s.mode)
  const id = useEditor((s) => s.id)
  const all = useEditor((s) => s.lib.assets)
  const addAsset = useEditor((s) => s.addAsset)
  const removeAssets = useEditor((s) => s.removeAssets)
  const setAssets = useEditor((s) => s.setAssets)

  const [usage, setUsage] = useState<UsageFilter>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [uploads, setUploads] = useState<Upload[]>([])
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  // الفيديو بيسأل الأول «من مكتبة الفيديوهات ولا الافتتاحيات ولا ملفاتي؟»
  const [source, setSource] = useState<VideoSource | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const counter = useRef(0)

  let rows = all.filter((a) => a.kind === kind)
  if (kind === 'image' && usage !== 'all') rows = rows.filter((a) => (usage === 'used' ? a.used : !a.used))
  const canDelete = kind !== 'audio'
  const allSelected = rows.length > 0 && rows.every((a) => selected.has(a.id))
  // «تحديد الكل» للفيديو أو الصور غير المستخدمة بس — عشان ماحدش يحدد كل المكتبة بالغلط
  const showSelectAll = kind === 'video' || (kind === 'image' && usage === 'unused')

  const finish: PickHandler = (url, meta) => {
    onPick?.(url, meta)
    onClose()
  }

  const refresh = () =>
    fetchAssets(mode, id)
      .then((res) => setAssets(res.assets))
      .catch(() => undefined)

  const uploadFiles = async (files: File[]) => {
    let picked = false
    for (const file of files) {
      const key = ++counter.current
      const patch = (change: Partial<Upload>) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)))
      setUploads((list) => [...list, { key, name: file.name, progress: 0, error: '' }])
      try {
        const thumb = await makeClientVideoThumbnail(file)
        const asset = await uploadAsset(mode, id, file, thumb, (progress) => patch({ progress }))
        addAsset(asset)
        setUploads((list) => list.filter((u) => u.key !== key))
        ui.toast(t('editorAssets.toast.uploaded', { name: asset.name }), 'ok')
        if (onPick && !picked && asset.kind === kind) {
          picked = true
          finish(asset.url, { poster: realThumb(asset), thumb: realThumb(asset) })
        }
      } catch (error) {
        const message = errorText(error, t, 'editorAssets.errors.upload')
        patch({ error: message })
        ui.toast(message, 'error')
      }
    }
  }

  const onFiles = (list: FileList | null) => {
    if (list?.length) void uploadFiles(Array.from(list))
    if (input.current) input.current.value = ''
  }

  const toggle = (assetId: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(assetId)) next.add(assetId)
      return next
    })

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.filter((a) => !a.used).map((a) => a.id)))

  const onFailedDelete = (error: unknown) => {
    ui.toast(errorText(error, t, 'editorAssets.errors.delete'), 'error')
    // 409 = الأصل بقى مستخدم من بعد ما القايمة اتحمّلت: نحدّث علامات «مستخدم»
    if (error instanceof ApiError && error.status === 409) void refresh()
  }

  const deleteOne = async (asset: AssetRow) => {
    if (!(await ui.confirm(t(`editorAssets.${asset.kind}.confirmOne`), { danger: true }))) return
    setDeleting(asset.id)
    try {
      await deleteAsset(mode, id, asset.id, asset.kind as DeletableKind)
      removeAssets([asset.id])
      setSelected((current) => new Set([...current].filter((x) => x !== asset.id)))
      ui.toast(t('editorAssets.toast.deleted'), 'ok')
    } catch (error) {
      onFailedDelete(error)
    } finally {
      setDeleting(null)
    }
  }

  const deleteSelected = async () => {
    const ids = [...selected]
    if (!ids.length || !canDelete) return
    if (!(await ui.confirm(t(`editorAssets.${kind}.confirmMany`, { count: ids.length }), { danger: true }))) return
    setBusy(true)
    try {
      const res = await bulkDeleteAssets(mode, id, ids, kind as DeletableKind)
      removeAssets(res.deleted)
      setSelected(new Set())
      ui.toast(t('editorAssets.toast.deletedMany'), 'ok')
    } catch (error) {
      onFailedDelete(error)
    } finally {
      setBusy(false)
    }
  }

  const title = t(`editorAssets.${kind}.title`)
  const choosing = kind === 'video' && source === null
  const shared = kind === 'video' && (source === 'videos' || source === 'intros') ? source : null
  const own = kind !== 'video' || source === 'mine'
  return (
    <Modal library label={title} onClose={onClose}>
      <h3>{title}</h3>
      {own && <p>{t(`editorAssets.${kind}.hint`)}</p>}
      <div className="ed-modal-actions ed-modal-actions--top">
        {own && (
          <button type="button" className="ed-btn ed-btn--primary" onClick={() => input.current?.click()}>
            {t('editorAssets.upload')}
          </button>
        )}
        {kind === 'video' && source !== null && (
          <button type="button" className="ed-btn" onClick={() => setSource(null)}>
            {t('editorAssets.source.back')}
          </button>
        )}
        <button type="button" className="ed-btn" onClick={onClose}>
          {t('editorAssets.close')}
        </button>
      </div>
      <input ref={input} type="file" accept={ACCEPT[kind]} multiple hidden data-testid="asset-file-input" onChange={(e) => onFiles(e.target.files)} />

      {own && uploads.length > 0 && (
        <ul className="ed-uploads" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.key} className={upload.error ? 'is-error' : undefined}>
              <span className="ed-upload-name">{upload.name}</span>
              {upload.error ? (
                <>
                  <span className="ed-upload-error">{upload.error}</span>
                  <button type="button" className="ed-icon-btn" aria-label={t('editorAssets.dismiss')} onClick={() => setUploads((list) => list.filter((u) => u.key !== upload.key))}>
                    ✕
                  </button>
                </>
              ) : (
                <progress max={1} value={upload.progress} aria-label={t('editorAssets.uploading', { name: upload.name })} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        className="ed-asset-scroll"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (own) onFiles(e.dataTransfer.files)
        }}
      >
        {choosing && <SourceChooser onChoose={setSource} />}
        {shared && <SharedVideos source={shared} onPick={finish} />}
        {kind === 'audio' && <SharedAudio onPick={finish} />}
        {own && (
          <div className="ed-assets">
            {kind === 'image' && (
              <select
                className="ed-asset-filter"
                aria-label={t('editorAssets.filter.label')}
                value={usage}
                onChange={(e) => {
                  setUsage(e.target.value as UsageFilter)
                  setSelected(new Set())
                }}
              >
                <option value="all">{t('editorAssets.filter.all')}</option>
                <option value="used">{t('editorAssets.filter.used')}</option>
                <option value="unused">{t('editorAssets.filter.unused')}</option>
              </select>
            )}
            {canDelete && (
              <div className="ed-asset-bulk">
                <span className="ed-asset-bulk-count">
                  {selected.size ? t(`editorAssets.${kind}.selected`, { count: selected.size }) : t('editorAssets.noneSelected')}
                </span>
                {showSelectAll && (
                  <button type="button" className="ed-btn ed-btn--sm" onClick={toggleAll}>
                    {allSelected ? t('editorAssets.deselectAll') : t('editorAssets.selectAll')}
                  </button>
                )}
                <button type="button" className="ed-btn ed-btn--sm ed-btn--danger" disabled={!selected.size || busy} onClick={() => void deleteSelected()}>
                  {t('editorAssets.deleteSelected')}
                </button>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="ed-empty">{t(`editorAssets.${kind}.empty`)}</p>
            ) : (
              rows.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  checked={selected.has(asset.id)}
                  deleting={deleting === asset.id}
                  onToggle={toggle}
                  onPick={(a) => finish(a.url, { poster: realThumb(a), thumb: realThumb(a) })}
                  onDelete={(a) => void deleteOne(a)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
