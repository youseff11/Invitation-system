import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AssetLibrary, type PickHandler } from '../assets/AssetLibrary'
import { CropDialog } from '../assets/CropDialog'
import { cssUrl, realThumb } from '../assets/util'
import { setSetting } from '../doc'
import { useEditor } from '../store'
import { useEditorUi } from '../ui'
import type { FieldProps } from './registry'

const str = (value: unknown) => (value == null ? '' : String(value))

/** فيديو الافتتاحية: اختياره بيضبط غلافه (‎settings.intro_poster‎) في نفس خطوة التراجع. */
const INTRO_VIDEO_KEY = 'intro_video'

function setIntroPoster(poster: string) {
  const { doc, commit } = useEditor.getState()
  if (str(doc.settings.intro_poster) === poster) return
  // نفس مفتاح الدمج بتاع ‎setSetting('intro_video')‎: الاتنين خطوة تراجع واحدة
  commit((d) => setSetting(d, 'intro_poster', poster), { coalesce: `setting:${INTRO_VIDEO_KEY}` })
}

/**
 * حقل صورة / وسائط (‎image‎ و‎media‎ في السكيما): معاينة + رابط + «اختر أو ارفع» (مكتبة الأصول،
 * ومعها مكتبة الموسيقى للصوت ومعرض الافتتاحيات للفيديو) + «قصّ الصورة».
 */
export function MediaField({ spec, value, onChange, id }: FieldProps) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const kind = spec.media_kind ?? 'image'
  const url = str(value)
  const [library, setLibrary] = useState(false)
  const [cropping, setCropping] = useState(false)
  const assets = useEditor((s) => s.lib.assets)
  const intros = useEditor((s) => s.lib.intros)
  const videos = useEditor((s) => s.lib.videos)
  const isIntro = kind === 'video' && spec.key === INTRO_VIDEO_KEY
  const introPoster = useEditor((s) => (isIntro ? str(s.doc.settings.intro_poster) : ''))

  // الأصل اللي الرابط الحالي بتاعه (لازم للقص، وبيدّي معاينة للفيديو)
  const asset = url ? assets.find((a) => a.url === url) : undefined
  let preview = ''
  if (kind === 'image') preview = url
  else if (kind === 'video' && url) preview = introPoster || [...intros, ...videos].find((i) => i.url === url)?.poster || realThumb(asset)

  const type = kind === 'image' ? 'image' : kind
  const pick: PickHandler = (picked, meta) => {
    onChange(picked)
    if (isIntro) setIntroPoster(meta.poster || meta.thumb || '')
  }

  const crop = () => {
    if (asset) setCropping(true)
    else ui.toast(t('editorAssets.field.cropNeedsLibrary'), 'error')
  }

  return (
    <div className="ed-image">
      <div
        className="ed-image-thumb"
        role="button"
        tabIndex={0}
        aria-label={t('editorAssets.field.preview')}
        style={preview ? cssUrl(preview) : undefined}
        onClick={() => setLibrary(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setLibrary(true)
          }
        }}
      >
        {preview ? '' : url ? (kind === 'video' ? '▶' : '♪') : '＋'}
      </div>
      <div className="ed-image-side">
        <input
          id={id}
          className="ed-input"
          type="text"
          value={url}
          placeholder={t(`editorAssets.field.paste.${type}`)}
          onChange={(e) => {
            onChange(e.target.value)
            if (isIntro) setIntroPoster('')
          }}
        />
        <button type="button" className="ed-btn ed-btn--sm" onClick={() => setLibrary(true)}>
          {t(`editorAssets.field.pick.${type}`)}
        </button>
        {kind === 'image' && (
          <button type="button" className="ed-btn ed-btn--sm" onClick={crop}>
            {t('editorAssets.field.crop')}
          </button>
        )}
      </div>

      {library && <AssetLibrary kind={kind} onPick={pick} onClose={() => setLibrary(false)} />}
      {cropping && asset && <CropDialog asset={asset} onDone={(cropped) => onChange(cropped.url)} onClose={() => setCropping(false)} />}
    </div>
  )
}
