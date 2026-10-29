import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { shortcutKey } from './frame/bridge'
import { isPxSlot } from './frame/interactions'
import { useElementActions } from './imported/useElementActions'
import { useEditor } from './store'
import { useEditorUi } from './ui'

/** الأسهم ← اتجاه الإزاحة الفيزيائي (الـtransform فيزيائي حتى في RTL) */
const ARROW_DIRS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** حقل كتابة؟ الحذف هنا بيمسح حروف مش أقسام. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** حفظ يدوي + تنبيه النجاح (الفشل بيتبلّغ عنه ‎useSaveFeedback‎ لأنه بيحصل من الحفظ التلقائي كمان). */
export function useSaveNow() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  return useCallback(async () => {
    const ok = await useEditor.getState().save()
    if (ok) ui.toast(t('editor.toast.saved'), 'ok')
    return ok
  }, [t, ui])
}

/**
 * اختصارات المحرر: Ctrl+S حفظ، Ctrl+Z تراجع، Ctrl+Y / Ctrl+Shift+Z إعادة، Delete حذف القسم المحدد.
 * بيرجّع ‎handle‎ عشان نفس الاختصارات تشتغل لما تتضغط جوّه الـiframe (بتوصل برسالة).
 */
export function useEditorShortcuts() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const saveNow = useSaveNow()
  const element = useElementActions()

  const handle = useCallback(
    (key: string, shiftKey: boolean, mod: boolean, target: EventTarget | null = null): boolean => {
      const state = useEditor.getState()
      const lower = key.toLowerCase()
      if (mod) {
        if (lower === 's') void saveNow()
        else if (lower === 'z' && !shiftKey) state.undo()
        else if (lower === 'y' || (lower === 'z' && shiftKey)) state.redo()
        // عنصر محدَّد جوّه قسم مستورد؟ Ctrl+C نسخ، Ctrl+V لصق بعده، Ctrl+D تكرار (وهو بيكتب: للمتصفح)
        else if (state.selEl && !shiftKey && !isTyping(target) && lower === 'c') element.copy()
        else if (state.selEl && !shiftKey && !isTyping(target) && lower === 'v') element.paste(false)
        else if (state.selEl && !shiftKey && !isTyping(target) && lower === 'd') element.duplicate()
        else if (state.selOverlay && !shiftKey && !isTyping(target) && lower === 'd') state.duplicateOverlay()
        else return false
        return true
      }
      // عنصر فوق القسم محدَّد (نص/صورة/زرار)؟ الحذف بيمسحه هو، وEsc بيلغي تحديده
      if (state.selOverlay && !isTyping(target)) {
        if (key === 'Delete' || key === 'Backspace') {
          state.removeOverlay()
          return true
        }
        if (key === 'Escape') {
          state.selectOverlay(state.selOverlay.blockId, null)
          return true
        }
      }
      // عنصر محدَّد جوّه قسم مستورد؟ الأسهم بتحرّكه، وEsc بيلغي تحديده، والحذف بيحذف العنصر مش القسم كله
      if (state.selEl && !isTyping(target)) {
        const dir = ARROW_DIRS[key]
        if (dir) {
          const px = isPxSlot(state.selEl.slot)
          const step = px ? (shiftKey ? 4 : 1) : shiftKey ? 1 : 0.25
          state.nudgeLayout(state.selEl.blockId, state.selEl.slot, dir[0] * step, dir[1] * step)
          return true
        }
        if (key === 'Escape') {
          state.selectElement(state.selEl.blockId, null)
          return true
        }
        if (key === 'Delete' || key === 'Backspace') {
          element.remove()
          return true
        }
      }
      if ((key === 'Delete' || key === 'Backspace') && !isTyping(target)) {
        const block = state.doc.blocks.find((b) => b.id === state.selected)
        if (!block || block.locked) return false
        state.remove(block.id)
        ui.toast(t('editor.toast.removed', { name: block.label || block.type }), 'ok')
        return true
      }
      return false
    },
    [saveNow, element, t, ui],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.ed-modal')) return
      const mod = event.ctrlKey || event.metaKey
      if (handle(mod ? shortcutKey(event) : event.key, event.shiftKey, mod, event.target)) event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handle])

  /** نسخة للرسائل الجاية من الـiframe (الإطار بيبعت حالة Ctrl مع المفتاح). */
  return useCallback((key: string, shiftKey: boolean, mod: boolean) => handle(key, shiftKey, mod), [handle])
}

/** خطأ الحفظ (يدوي أو تلقائي) → تنبيه مرة واحدة؛ ولو حصل مع الرابط نوضّح إنه الرابط. */
export function useSaveFeedback() {
  const { t } = useTranslation()
  const ui = useEditorUi()
  useEffect(
    () =>
      useEditor.subscribe((state, previous) => {
        if (state.saveStatus !== 'error' || previous.saveStatus === 'error') return
        const slug = state.fieldErrors.slug
        ui.toast(slug ? t('editor.toast.slug', { message: slug }) : state.saveError || t('editor.toast.saveFailed'), 'error')
      }),
    [t, ui],
  )

  // تحذير قبل إغلاق الصفحة بتعديلات مش محفوظة
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useEditor.getState().saveStatus === 'saved') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}
