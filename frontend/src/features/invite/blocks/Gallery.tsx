import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { useInvite } from '../context'
import { text } from '../style'
import type { BlockData } from '../types'
import { Frame } from './Frame'

interface GalleryProps {
  heading?: string
  images?: { src?: string; caption?: string }[]
  layout?: string
  columns?: number
  gap?: number
  image_radius?: number
  aspect?: string
  lightbox?: boolean
}

/** تكبير الصورة: ضغطة تقفله، وESC كمان — نفس ‎initLightbox‎. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="lb-lightbox" role="dialog" onClick={onClose}>
      <img alt="" src={src} />
    </div>,
    document.body,
  )
}

export function Gallery({ block }: { block: BlockData }) {
  const { t } = useInvite()
  const p = block.props as GalleryProps
  const [open, setOpen] = useState('')
  const images = p.images ?? []
  const style = {
    '--cols': text(p.columns),
    '--gap': `${text(p.gap)}px`,
    '--img-radius': `${text(p.image_radius)}px`,
    '--aspect': text(p.aspect),
  } as CSSProperties
  return (
    <Frame block={block}>
      {p.heading && (
        <h2 className="lb-heading" data-slot="heading" data-move="heading" data-ts="heading">
          {p.heading}
        </h2>
      )}
      <div
        data-move="gallery"
        className={`lb-gallery lb-gallery--${text(p.layout)}`}
        style={style}
        data-lightbox={p.lightbox ? '1' : undefined}
      >
        {images.length ? (
          images
            .filter((im) => im.src)
            .map((im, i) => (
              <figure className="lb-gitem" key={i}>
                <img
                  src={im.src}
                  alt={im.caption || ''}
                  loading="lazy"
                  onClick={
                    p.lightbox ? (e) => setOpen(e.currentTarget.currentSrc || e.currentTarget.src) : undefined
                  }
                />
                {im.caption && <figcaption>{im.caption}</figcaption>}
              </figure>
            ))
        ) : (
          <div className="lb-gempty">{t('empty.gallery')}</div>
        )}
      </div>
      {open && <Lightbox src={open} onClose={() => setOpen('')} />}
    </Frame>
  )
}
