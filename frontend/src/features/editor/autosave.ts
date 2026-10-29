import { useEditor } from './store'

/** سكوت قبل الحفظ التلقائي: المستند بيتبعت كامل (والقوالب المستوردة تقيلة) فمنستناش حرف بحرف. */
export const AUTOSAVE_IDLE = 2500
/** حفظة شغالة دلوقتي؟ نحاول تاني بعد المدة دي. */
export const AUTOSAVE_RETRY = 1200

/**
 * الحفظ التلقائي. بيراقب الستور: أي تعديل بيعيد العدّاد، ولما المستخدم يسكت ‎AUTOSAVE_IDLE‎
 * بيحفظ. لو الحفظ فشل بيقف (عشان مايفضلش يرمي أخطاء كل ثانيتين) لحد ما حفظة يدوية تنجح.
 * بيرجّع دالة الإيقاف.
 */
export function startAutosave(idle = AUTOSAVE_IDLE, retry = AUTOSAVE_RETRY): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let off = false
  let seenRev = useEditor.getState().rev

  const arm = (wait: number) => {
    clearTimeout(timer)
    timer = setTimeout(run, wait)
  }

  function run() {
    timer = undefined
    if (stopped || off) return
    const state = useEditor.getState()
    if (state.saveStatus === 'saving') return arm(retry)
    if (state.saveStatus !== 'dirty') return
    void state.save().then((ok) => {
      if (!ok) off = true
    })
  }

  const unsubscribe = useEditor.subscribe((state) => {
    if (state.saveStatus === 'saved') off = false
    if (state.saveStatus !== 'dirty' || off) return
    if (state.rev !== seenRev) {
      seenRev = state.rev
      arm(idle)
    } else if (!timer) {
      arm(idle) // اتعدّل أثناء الحفظ: الحفظة اللي خلصت سابت الحالة «غير محفوظ»
    }
  })

  return () => {
    stopped = true
    clearTimeout(timer)
    unsubscribe()
  }
}
