import type { FromFrame, PreviewPayload } from '../types'

/**
 * ضغطات الشاشة الافتتاحية داخل المحرر. في الدعوة الحقيقية أي لمسة بتفتحها، لكن المصمّم محتاج يعدّل عليها:
 *
 * - ضغطة واحدة: ما بتعمل حاجة (تحديد/سحب بس — السحب في ‎extraDrags‎).
 * - ضغطتين: تعديل نص العنصر في مكانه (ملاحظة، نص، زرار الدخول، نص زرار التشغيل). ‎Enter‎ أو الضغط برّه = حفظ، ‎Escape‎ = إلغاء.
 * - تلات ضغطات ورا بعض: تعدّي الافتتاحية وتفتح الدعوة (بنادي ‎window.__lbIntro.open‎ اللي الافتتاحية بتعرضه).
 *
 * العدّ من ‎event.detail‎ (المتصفح بيعدّ الضغطات السريعة في نفس المكان). كود الافتتاحية ‎.lb-intro-extra‎
 * ليه منطقه (اختيار العنصر) وبيعدّي زي ما هو.
 */

/** عنصر الافتتاحية → مفتاح الإعداد اللي بيتكتب فيه */
const FIELDS: Record<string, string> = {
  note: 'intro_note',
  text: 'intro_text',
  button: 'intro_button',
  play: 'intro_play_label',
}

type Options = { payload: () => PreviewPayload | null; send: (message: FromFrame) => void }

interface Editing {
  node: HTMLElement
  field: string
  original: string
}

/** العقدة اللي فيها النص: العنصر نفسه، أو ‎.lb-intro-play-text‎ في زرار التشغيل (الأيقونة وحدها مالهاش نص يتعدّل) */
function textHolder(item: HTMLElement): HTMLElement | null {
  if (item.getAttribute('data-intro-item') !== 'play') return item
  const label = item.querySelector<HTMLElement>('.lb-intro-play-text')
  if (label) return label
  return item.classList.contains('lb-intro-play--plain') ? item : null
}

export function installIntroClicks({ payload, send }: Options): () => void {
  let editing: Editing | null = null

  const finish = (save: boolean) => {
    const current = editing
    if (!current) return
    editing = null
    const { node, field, original } = current
    node.removeEventListener('keydown', onKeyDown)
    node.removeEventListener('focusout', onFocusOut)
    node.removeAttribute('contenteditable')
    const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    // نص فاضي كان هيخفي العنصر من الافتتاحية ومانقدرش نرجعله — نرجّع الأصلي
    if (!save || !value) {
      node.textContent = original
      return
    }
    node.textContent = value
    if (value !== original) send({ type: 'lb-editor:intro-text', key: field, value })
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation() // مفيش اختصارات المحرر (حذف/نسخ عنصر) أثناء الكتابة
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    } else if (e.key === ' ' && editing?.node.closest('button')) {
      // المسافة على الزرار بتعمل «ضغطة» بدل ما تكتب
      e.preventDefault()
      editing.node.ownerDocument.execCommand('insertText', false, ' ')
    }
  }
  function onFocusOut() {
    finish(true)
  }

  const start = (item: HTMLElement) => {
    const key = item.getAttribute('data-intro-item') ?? ''
    const field = FIELDS[key]
    if (!field) return
    const node = textHolder(item)
    if (!node) return // زرار تشغيل بأيقونة من غير نص
    const p = payload()
    if (p && p.lang !== p.baseLang) {
      send({ type: 'lb-editor:refused' }) // الكتابة في المعاينة المترجَمة كانت هتغيّر النص الأصلي
      return
    }
    if (editing?.node === node) return
    finish(true)
    editing = { node, field, original: node.textContent ?? '' }
    node.setAttribute('contenteditable', 'plaintext-only')
    node.addEventListener('keydown', onKeyDown)
    node.addEventListener('focusout', onFocusOut)
    node.focus()
    const doc = node.ownerDocument
    const range = doc.createRange()
    range.selectNodeContents(node)
    const selection = doc.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const onClick = (e: MouseEvent) => {
    const target = e.target
    if (!(target instanceof Element)) return
    if (!target.closest('.lb-intro') || target.closest('.lb-intro-extra')) return
    // الضغطة بتفضل جوّه الافتتاحية: مفيش فتح، ومفيش بدء فيديو، ومفيش لينك
    e.stopPropagation()
    e.preventDefault()
    if (e.detail >= 3) {
      finish(true) // نحفظ اللي اتكتب قبل ما الافتتاحية تتقفل
      ;(target.ownerDocument.defaultView as (Window & { __lbIntro?: { open: () => void } }) | null)?.__lbIntro?.open()
      return
    }
    if (e.detail === 2) {
      const item = target.closest<HTMLElement>('[data-intro-item]')
      if (item && item !== editing?.node) start(item)
    }
  }

  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    finish(false)
  }
}
