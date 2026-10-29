import { styleTarget } from './nodeEdit'

/**
 * قراءة (بس) من العقدة الحية في إطار المعاينة — القيم المحسوبة اللي مالهاش ‎style‎ مضمّن
 * (حجم خط القالب مثلاً) عشان أشرطة اللوحة تبدأ من الرقم الحقيقي. مفيش كتابة هنا أبداً.
 */
function liveTarget(blockId: string, slot: string): HTMLElement | null {
  const doc = document.querySelector<HTMLIFrameElement>('.ed-device iframe')?.contentDocument
  const scope =
    blockId === '__intro'
      ? doc?.querySelector('.lb-intro')
      : Array.from(doc?.querySelectorAll('[data-block]') ?? []).find((n) => n.getAttribute('data-block') === blockId)
  const node = Array.from(scope?.querySelectorAll('[data-move]') ?? []).find((n) => n.getAttribute('data-move') === slot)
  return node ? (styleTarget(node) as HTMLElement) : null
}

/** القيمة المحسوبة لخاصية عنصر في المعاينة، أو ‎''‎ لو العنصر مش ظاهر. */
export function computedValue(blockId: string, slot: string, prop: string): string {
  const target = liveTarget(blockId, slot)
  const view = target?.ownerDocument.defaultView
  return target && view ? view.getComputedStyle(target).getPropertyValue(prop) : ''
}
