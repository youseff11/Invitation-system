import { lazy, Suspense, type ComponentType } from 'react'

import type { BlockData } from '../types'
import { Countdown } from './Countdown'
import {
  Agenda,
  Branding,
  Buttons,
  CustomHtml,
  Details,
  Divider,
  Hero,
  Hosts,
  ImageBlock,
  Location,
  Qr,
  Quote,
  Spacer,
  TextBlock,
  Wishes,
} from './content'
import { LAZY_TYPES, loadGallery, loadRsvp, loadShare, loadVideo } from './lazy'

type BlockComponent = ComponentType<{ block: BlockData }>

const Rsvp = lazy(loadRsvp)
const Video = lazy(loadVideo)
const Gallery = lazy(loadGallery)
const Share = lazy(loadShare)

/** مكان القسم لحد ما الـchunk يوصل: نفس الـid والكلاسات فالروابط (‎#rsvp‎) تشتغل. */
function Placeholder({ block }: { block: BlockData }) {
  const { attrs } = block
  return <section id={attrs.id} className={attrs.className} data-block={block.id} data-block-type={block.type} />
}

/** نوع البلوك → المكوّن. نوع مش معروف بيتخطّى (زي ‎render_document‎ لما مفيش spec). */
const REGISTRY: Record<string, BlockComponent> = {
  hero: Hero,
  text: TextBlock,
  quote: Quote,
  hosts: Hosts,
  countdown: Countdown,
  details: Details,
  agenda: Agenda,
  location: Location,
  gallery: Gallery,
  image: ImageBlock,
  video: Video,
  rsvp: Rsvp,
  wishes: Wishes,
  qr: Qr,
  share: Share,
  divider: Divider,
  spacer: Spacer,
  buttons: Buttons,
  branding: Branding,
  custom_html: CustomHtml,
}

export function BlockView({ block }: { block: BlockData }) {
  const Component = Object.hasOwn(REGISTRY, block.type) ? REGISTRY[block.type] : null
  if (!Component) return null
  if (block.type === 'rsvp' && !block.rsvp) return null
  if (LAZY_TYPES.has(block.type)) {
    return (
      <Suspense fallback={<Placeholder block={block} />}>
        <Component block={block} />
      </Suspense>
    )
  }
  return <Component block={block} />
}
