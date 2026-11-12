import type { BlockData, IntroData } from './types'

const EMBED = /youtube\.com|youtu\.be|vimeo\.com/i

/**
 * القسم اللي بيكمّل فيديو الافتتاحية — أو ‎''‎ لو مفيش.
 *
 * المصمّم بيقطّع فيديو واحد لاتنين: الافتتاحية، وبعدها أول قسم فيديو بيبدأ
 * من آخر فريم فيها. عشان يبانوا فيديو واحد لازم التاني يتعرض **بنفس مكان
 * ومقاس** الافتتاحية: مالي الشاشة وبنفس القص (‎cover‎). قبل كده القسم كان
 * بعرض الشاشة بس — على تليفون ‎390×844‎ الصورة كانت بتصغر ‎22%‎ وتطلع لفوق
 * لحظة ما الافتتاحية تخلص، فالانتقال باين كقطع حتى والفريمين متطابقين.
 *
 * الشرط: الافتتاحية فيديو، وأول قسم ظاهر قسم فيديو تلقائي بملف (مش يوتيوب)
 * ومن غير عنوان فوقه (العنوان بيزق الفيديو لتحت فمايبقاش مكان الافتتاحية).
 */
export function introContinuationId(intro: IntroData | null | undefined, blocks: BlockData[]): string {
  if (!intro?.video) return ''
  const first = blocks.find((b) => !b.hidden)
  if (!first || first.type !== 'video') return ''
  const p = first.props as { url?: unknown; autoplay?: unknown; heading?: unknown }
  const url = String(p.url ?? '')
  if (!url || EMBED.test(url) || !p.autoplay || String(p.heading ?? '').trim()) return ''
  return first.id
}
