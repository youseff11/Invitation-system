/**
 * لا hover في معاينة المحرر — نهائياً.
 *
 * ليه: ‎:hover‎ بتتطبّق على الآباء كمان، فأي تأثير hover في CSS القالب المستورد (أنيميشن، transform، filter،
 * transition) بيشتغل أو بيتلغي أول ما الماوس يقف على أي حاجة جوّه القسم — وأنيميشنات الدخول بتتعاد من الأول
 * كل ما الماوس يسيب. وعلى الموبايل/اللمس الـhover بيفضل «لازق» بعد الضغطة. المحرر ماله لازمة بـhover:
 * التحديد بالضغط (‎.lb-el-picked‎).
 *
 * إزاي: بنشيل **كل** قاعدة CSS فيها ‎:hover‎ من كل أوراق الأنماط في الإطار (ستايل القالب المضمّن، الـCSS المشترك،
 * وحتى ‎invite.css‎ نفسه) من الـCSSOM. القاعدة اللي selectors بعضها hover وبعضها لأ بتتحوّل لغير الـhover بس.
 * ورقة جديدة (النص اتبدّل بعد تحديث المعاينة) بتتعالج لوحدها — الورقة المعالَجة بتتخطّى.
 */

const seen = new WeakSet<object>()

/** يقسّم قايمة selectors على الفاصلة اللي برّه الأقواس بس (‎:is(a, b)‎ و‎:not(a, b)‎ فيهم فواصل جوّه). */
export function splitSelectors(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

type Container = { cssRules: CSSRuleList; deleteRule: (index: number) => void }

function stripRules(container: Container): number {
  let touched = 0
  const rules = container.cssRules
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i] as CSSRule & { selectorText?: string; cssRules?: CSSRuleList; deleteRule?: (i: number) => void }
    if (typeof rule.selectorText === 'string') {
      if (!rule.selectorText.includes(':hover')) continue
      const keep = splitSelectors(rule.selectorText).filter((s) => !s.includes(':hover'))
      if (keep.length) rule.selectorText = keep.join(', ')
      else container.deleteRule(i)
      touched++
    } else if (rule.cssRules && typeof rule.deleteRule === 'function') {
      touched += stripRules(rule as unknown as Container)
    }
  }
  return touched
}

/** يشيل قواعد الـhover من كل ورقة لسه ماتعالجتش. بيرجّع عدد القواعد اللي اتلمست. */
export function stripHover(doc: Document = document): number {
  let touched = 0
  for (const sheet of Array.from(doc.styleSheets)) {
    if (seen.has(sheet)) continue
    try {
      touched += stripRules(sheet)
      seen.add(sheet)
    } catch {
      // ورقة من أصل تاني (خطوط جوجل…) أو لسه ماتحمّلتش — مالهاش قواعد hover تخصّنا
    }
  }
  return touched
}

/** يشغّل الشيل دلوقتي وبعد تحميل أي ‎<link rel=stylesheet>‎. بيرجّع دالة الفك. */
export function installNoHover(doc: Document = document): () => void {
  stripHover(doc)
  const onLoad = (e: Event) => {
    if (e.target instanceof HTMLLinkElement) stripHover(doc)
  }
  doc.addEventListener('load', onLoad, true)
  return () => doc.removeEventListener('load', onLoad, true)
}
