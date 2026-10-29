/**
 * البلوكات التقيلة أو اللي تحت الشاشة الأولى بتتحمّل في chunks منفصلة: React
 * نفسه بياخد ~٦٨KB gzip لوحده، فكل KB زيادة في أول تحميل بيتحسب على موبايل
 * الضيف. بتتجاب في الخلفية أول ما الصفحة تفضى (‎prefetchBlocks‎).
 */
export const loadRsvp = () => import('./Rsvp').then((m) => ({ default: m.Rsvp }))
export const loadVideo = () => import('./Video').then((m) => ({ default: m.Video }))
export const loadGallery = () => import('./Gallery').then((m) => ({ default: m.Gallery }))
export const loadShare = () => import('./Share').then((m) => ({ default: m.Share }))

const LOADERS: Record<string, () => Promise<unknown>> = {
  rsvp: loadRsvp,
  video: loadVideo,
  gallery: loadGallery,
  share: loadShare,
}

export const LAZY_TYPES = new Set(Object.keys(LOADERS))

export function prefetchBlocks(types: Set<string>) {
  for (const type of types) if (Object.hasOwn(LOADERS, type)) void LOADERS[type]()
}
