import type { HeadCss, RenderPayload } from './types'

/**
 * تنسيق الصفحة اللي عايش في ‎<head>‎ وبيتغيّر مع اللغة (خطوط، إزاحات النصوص،
 * ستايل الأقسام المستوردة). الـshell بيطبعهم على السيرفر؛ وهنا بنحدّثهم لما
 * الضيف يبدّل اللغة — من غير كده الخط اللي المصمّم اختاره للترجمة مايبانش.
 */
const HEAD_STYLES: [keyof HeadCss, string][] = [
  ['font', 'data-font-faces'],
  ['layout', 'data-lb-layout-css'],
  ['shared', 'data-imported-css'],
  ['zero', 'data-zero-block-css'],
]

export function syncHeadStyles(css: HeadCss) {
  for (const [key, attr] of HEAD_STYLES) {
    const next = css[key] || ''
    const current = document.head.querySelector<HTMLStyleElement>(`style[${attr}]`)
    // مانلمسش اللي ما اتغيّرش: إعادة كتابة ‎@font-face‎ بتعمل رمشة
    if (current && (current.textContent || '') === next) continue
    if (!next) {
      current?.remove()
      continue
    }
    if (current) {
      current.textContent = next
      continue
    }
    const node = document.createElement('style')
    node.setAttribute(attr, '')
    node.textContent = next
    document.head.appendChild(node)
  }
}

/** لغة الصفحة واتجاهها والعنوان والوصف ومتغيّرات الثيم على ‎<body>‎. */
export function applyPageMeta(payload: RenderPayload) {
  const root = document.documentElement
  root.setAttribute('lang', payload.lang)
  root.setAttribute('dir', payload.dir)
  document.title = payload.head.title
  const description = document.querySelector('meta[name="description"]')
  if (description) description.setAttribute('content', payload.head.description || '')

  // متغيّرات الثيم عايشة في ‎style‎ على ‎<body>‎ (ومنها خط العناوين والمتن لكل لغة).
  // ‎overflow‎ مش من الثيم — الافتتاحية هي اللي بتحطّه وقفله لازم يفضل.
  const body = document.body
  if ((body.getAttribute('style') || '') !== payload.bodyStyle) {
    const overflow = body.style.overflow
    body.setAttribute('style', payload.bodyStyle)
    if (overflow) body.style.overflow = overflow
  }
}
