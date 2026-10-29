import { useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useEditor } from '../store'
import type { AssetRow } from '../types'
import { useEditorUi } from '../ui'
import { cropAsset } from './api'
import { applyRatio, dragBox, initialBox, RATIOS, toRatios, type Box, type Handle } from './cropMath'
import { errorText } from './errors'
import { Modal } from './Modal'

interface Props {
  asset: AssetRow
  /** الأصل الجديد (المقصوص) — الحقل بياخد رابطه */
  onDone: (asset: AssetRow) => void
  onClose: () => void
}

const HANDLES: Exclude<Handle, null>[] = ['nw', 'ne', 'sw', 'se']

interface Drag {
  x: number
  y: number
  start: Box
  handle: Handle
}

/** مستطيل الصورة جوّه المسرح (بكسل) — الصورة متوسّطة فمكانها بيتغيّر مع المقاس. */
function boundsOf(stage: HTMLElement, image: HTMLElement): Box {
  const r = image.getBoundingClientRect()
  const s = stage.getBoundingClientRect()
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
}

/**
 * نافذة القص. القص بيتم على السيرفر من النسخة الأصلية (‎asset.source‎) بنِسَب مش بكسل، فمفيش
 * فقد جودة متراكم والأصل بيفضل محفوظ لإعادة القص. الناتج أصل جديد بيتضاف للمكتبة.
 */
export function CropDialog({ asset, onDone, onClose }: Props) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const mode = useEditor((s) => s.mode)
  const id = useEditor((s) => s.id)
  const addAsset = useEditor((s) => s.addAsset)
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<Drag | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [ratioKey, setRatioKey] = useState('free')
  const [busy, setBusy] = useState(false)

  const ratio = RATIOS.find((r) => r.key === ratioKey)?.ratio ?? 0
  const bounds = () => boundsOf(stage.current!, image.current!)

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!box) return
    const handle = (event.target as HTMLElement).getAttribute('data-handle') as Handle
    drag.current = { x: event.clientX, y: event.clientY, start: box, handle }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setBox(dragBox(d.start, d.handle, event.clientX - d.x, event.clientY - d.y, ratio, bounds()))
  }
  const onUp = () => {
    drag.current = null
  }

  const chooseRatio = (key: string, value: number) => {
    setRatioKey(key)
    if (box) setBox(applyRatio(box, value, bounds()))
  }

  const apply = async () => {
    if (!box || !stage.current || !image.current) return
    setBusy(true)
    try {
      const res = await cropAsset(mode, id, asset.id, toRatios(box, bounds()))
      addAsset(res.asset)
      onDone(res.asset)
      ui.toast(t('editorAssets.toast.cropped'), 'ok')
      onClose()
    } catch (error) {
      ui.toast(errorText(error, t, 'editorAssets.errors.crop'), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal wide label={t('editorAssets.crop.title')} onClose={onClose}>
      <h3>{t('editorAssets.crop.title')}</h3>
      <p className="ed-hint">{t('editorAssets.crop.hint')}</p>

      <div className="ed-crop-ratios" role="group" aria-label={t('editorAssets.crop.ratio')}>
        {RATIOS.map(({ key, ratio: value }) => (
          <button
            key={key}
            type="button"
            className={`ed-btn ed-btn--sm${key === ratioKey ? ' is-active' : ''}`}
            aria-pressed={key === ratioKey}
            onClick={() => chooseRatio(key, value)}
          >
            {key === 'free' ? t('editorAssets.crop.free') : key === '1:1' ? t('editorAssets.crop.square') : key}
          </button>
        ))}
      </div>

      <div className="ed-crop-stage" ref={stage}>
        <img
          ref={image}
          src={asset.source || asset.url}
          alt={asset.name}
          draggable={false}
          onLoad={() => setBox(initialBox(bounds()))}
        />
        {box && (
          <div
            className="ed-crop-box"
            data-testid="crop-box"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {HANDLES.map((handle) => (
              <i key={handle} data-handle={handle} />
            ))}
          </div>
        )}
      </div>

      <div className="ed-modal-actions">
        <button type="button" className="ed-btn" onClick={onClose}>
          {t('editorAssets.cancel')}
        </button>
        <button type="button" className="ed-btn ed-btn--primary" disabled={!box || busy} onClick={() => void apply()}>
          {busy ? t('editorAssets.crop.busy') : t('editorAssets.crop.apply')}
        </button>
      </div>
    </Modal>
  )
}
