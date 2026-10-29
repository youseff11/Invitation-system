/** المستخدم مفعّل «تقليل الحركة» في النظام؟ (اللقطات المرجعية بتتصوّر بيه). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
