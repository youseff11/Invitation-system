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

/** إطار الموبايل في المحرر — المرجع اللي الكلام فوق الفيديو اتظبط وهو شايفه. */
export const CONT_REF_W = 390
export const CONT_REF_H = 844

/**
 * مقاس ومكان كود القسم («كود متقدّم») فوق الفيديو اللي بيكمّل الافتتاحية.
 *
 * الفيديو هنا ‎cover‎ بطول الشاشة، فحجم الصورة بيتحدد بالطول كمان مش بالعرض
 * بس: ‎390×844‎ (المحرر) الصورة ‎×0.66‎، والآيفون جوّه سفاري (‎390×664‎) ‎×0.54‎،
 * وأندرويد ‎412×800‎ ‎×0.63‎. الكلام كان بيتكبّر بالعرض بس (‎--lb-fit‎)، فـ«حفل زفاف»
 * اتقاس عند ‎19%‎ من طول الصورة في المحرر و‎0%‎ على الآيفون و‎10%‎ على أندرويد.
 *
 * الحل: الكلام يتكبّر بنفس نسبة الصورة لصورة المرجع (‎k‎)، وينزاح بحيث يفضل
 * في نفس النقطة من الصورة. الصورة متوسّطة في القسم، وكود القسم بيبدأ تحته
 * على طول (القسم ‎100dvh‎ من غير حشو). يعني بدايته في المرجع ‎REF_H/2‎ تحت نص
 * الصورة، ولازم تبقى ‎k×REF_H/2‎ تحت نصها على الجهاز ده — والفرق ده هو
 * ‎shift‎، بوحدات الكود نفسه (بعد التكبير بيتضرب في ‎k‎).
 */
export function contFit(
  width: number,
  height: number,
  videoW: number,
  videoH: number,
): { k: number; shift: number } {
  if (!(width > 0 && height > 0 && videoW > 0 && videoH > 0)) return { k: 1, shift: 0 }
  const scale = Math.max(width / videoW, height / videoH)
  const ref = Math.max(CONT_REF_W / videoW, CONT_REF_H / videoH)
  const k = scale / ref
  const shift = CONT_REF_H / 2 - height / (2 * k)
  return { k: Math.round(k * 10000) / 10000, shift: Math.round(shift * 100) / 100 }
}
