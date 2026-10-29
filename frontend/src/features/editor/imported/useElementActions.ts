import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { NodeEdit } from './nodeEdit'
import { useEditor, type ElementOutcome } from '../store'
import { useEditorUi } from '../ui'

/** تنبيه رفض المعاينة المترجَمة مرة كل ٢٫٥ ثانية مهما كتب/حرّك المستخدم (نفس إيقاع الإطار) — لكل نافذة تنبيهات. */
const lastRefusal = new WeakMap<object, number>()

/**
 * عمليات العنصر المحدَّد (نسخ/لصق/تكرار/حذف/إضافة/الأب) مع تنبيهاتها — واحدة للوحة الأزرار والطبقات
 * واختصارات لوحة المفاتيح، فكلهم يتكلموا بنفس الرسائل. العملية نفسها في الـstore (خطوة تراجع واحدة).
 */
export function useElementActions() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  return useMemo(() => {
    /** عملية ناجحة → تنبيه ‎okKey‎؛ مرفوضة → سبب الرفض. بيرجّع نجحت ولا لأ. */
    const report = (outcome: ElementOutcome, okKey?: string) => {
      if (outcome === 'ok') {
        if (okKey) ui.toast(t(okKey), 'ok')
        return true
      }
      if (outcome === 'translated') {
        const now = Date.now()
        if (now - (lastRefusal.get(ui) ?? 0) > 2500) {
          lastRefusal.set(ui, now)
          ui.toast(t('editorInline.refused'), 'info')
        }
      } else ui.toast(t(`editorInline.element.fail.${outcome}`), outcome === 'empty' || outcome === 'top' ? 'info' : 'error')
      return false
    }
    const state = () => useEditor.getState()
    return {
      copy: () => report(state().copyElement(), 'editorInline.element.copied'),
      paste: (inside = false) =>
        report(state().pasteElement(inside), inside ? 'editorInline.element.pastedInside' : 'editorInline.element.pasted'),
      duplicate: () => report(state().duplicateElement(), 'editorInline.element.duplicated'),
      remove: (slot?: string) => report(state().deleteElement(slot), 'editorInline.element.deleted'),
      addText: () => report(state().addElement('text', t('editorInline.element.newText')), 'editorInline.element.added'),
      addImage: (url: string) => report(state().addElement('image', url), 'editorInline.element.added'),
      selectParent: () => report(state().selectParentElement()),
      /** تعديل من اللوحة (نص/تنسيق/صورة): من غير تنبيه نجاح — الشريط بيبعت عشرات في الثانية */
      edit: (edit: NodeEdit, coalesce?: string) => report(state().editElement(edit, coalesce)),
    }
  }, [t, ui])
}
