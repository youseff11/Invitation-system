import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fetchPreview } from '../api'
import { baseLangOf, useEditor } from '../store'
import type { FromFrame } from '../types'
import { useEditorUi } from '../ui'
import { parseMessage, sendToFrame } from './bridge'
import { useIntroBus } from './introBus'

/** وقفة بعد آخر تعديل قبل ما نطلب معاينة جديدة (السيرفر بيرندر المستند كله). */
export const PREVIEW_WAIT = 280

type Payload = Awaited<ReturnType<typeof fetchPreview>>
type Rendered = { lang: string; fields: unknown; payload: Payload }

/**
 * آخر رسمة اتجابت لكل نسخة من المستند (المستند غير قابل للتعديل: كل تعديل بيعمل كائن جديد).
 * التراجع/الإعادة بيرجّعوا نفس الكائن، فبنعرض رسمته فوراً من غير وقفة ولا سيرفر.
 * ‎WeakMap‎: النسخة اللي بتخرج من سجل التراجع بتتشال معاها رسمتها.
 */
const rendered = new WeakMap<object, Rendered>()

/** كام نسخة من سجل التراجع بنجهّز رسمتها في الخلفية، والوقفة قبل ما نبدأ. */
const PREFETCH_DEPTH = 3
const PREFETCH_WAIT = 150

/** الرابط بيتنضّف مع الحفظ (كائن بيانات جديد) ومابيأثرش على الرسم، فمابنقارنوش. */
function sameFields(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  keys.delete('slug')
  return [...keys].every((key) => x[key] === y[key])
}

/** رسمة نسخة المستند دي لو اتجابت قبل كده بنفس اللغة وبيانات المناسبة. */
function lookup(doc: object, lang: string, fields: unknown): Payload | null {
  const hit = rendered.get(doc)
  return hit && hit.lang === lang && sameFields(hit.fields, fields) ? hit.payload : null
}

interface Props {
  /** اختصار لوحة مفاتيح اتضغط جوّه الـiframe */
  onKey: (key: string, shiftKey: boolean, mod: boolean) => void
}

/**
 * المعاينة الحية: الـiframe (‎/editor-frame/‎) بيرسم الحمولة اللي هنا بنطلبها من السيرفر من المستند
 * الحالي (حتى غير المحفوظ). الرد القديم بيتلغي لو اتعدّل حاجة تاني، وأي طلب شغّال بيتقطع.
 */
export function PreviewPane({ onKey }: Props) {
  const { t } = useTranslation()
  const ui = useEditorUi()
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(0) // بيزيد كل ما الإطار يقول «جاهز» (بما فيه إعادة تحميله)
  const [busy, setBusy] = useState(false)
  const rev = useEditor((s) => s.rev)
  const device = useEditor((s) => s.device)
  const selected = useEditor((s) => s.selected)
  const selectSource = useEditor((s) => s.selectSource)
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  const uiRef = useRef(ui)
  uiRef.current = ui
  const lastRefused = useRef(0)

  // رسائل الإطار
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = parseMessage<FromFrame>(event, frame.current?.contentWindow)
      if (!message) return
      if (message.type === 'lb-editor:ready') setReady((n) => n + 1)
      else if (message.type === 'lb-editor:intro-visible') useIntroBus.getState().setVisible(message.visible)
      else if (message.type === 'lb-editor:select') useEditor.getState().select(message.id, 'preview')
      else if (message.type === 'lb-editor:key') onKeyRef.current(message.key, message.shiftKey, message.mod)
      else if (message.type === 'lb-editor:text') useEditor.getState().setProp(message.id, message.key, message.value)
      else if (message.type === 'lb-editor:element') useEditor.getState().selectElement(message.id, message.slot)
      else if (message.type === 'lb-editor:overlay-pick') {
        const state = useEditor.getState()
        if (message.id && message.index !== null) state.selectOverlay(message.id, message.index)
        else if (state.selOverlay) state.selectOverlay(state.selOverlay.blockId, null)
      }
      else if (message.type === 'lb-editor:html') useEditor.getState().setHtml(message.id, message.value, message.silent)
      else if (message.type === 'lb-editor:code-number') useEditor.getState().applyCodeNumbers(message.id, message.items)
      else if (message.type === 'lb-editor:node-edits') useEditor.getState().applyNodeEdits(message.id, message.edits)
      else if (message.type === 'lb-editor:section-height') useEditor.getState().setStyle(message.id, message.key, message.value)
      else if (message.type === 'lb-editor:overlay')
        useEditor.getState().setOverlay(message.id, message.index, message.values)
      else if (message.type === 'lb-editor:intro-item') useEditor.getState().setIntroItem(message.key, message.x, message.y)
      else if (message.type === 'lb-editor:intro-text') useEditor.getState().setSetting(message.key, message.value)
      else if (message.type === 'lb-editor:layout')
        useEditor.getState().setLayout(message.id, message.slot, message.dx, message.dy)
      else if (message.type === 'lb-editor:refused') {
        // تنبيه واحد كل ٢٫٥ ثانية مهما كتب
        const now = Date.now()
        if (now - lastRefused.current > 2500) {
          lastRefused.current = now
          uiRef.current.toast(t('editorInline.refused'), 'info')
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [t])

  // طلب المعاينة بعد كل تعديل
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const { signal } = controller

    // نجهّز في الخلفية رسمة آخر نسخ في سجل التراجع، فالتراجع الجاي (حتى لو التعديلات لسه مش محفوظة) يلاقيها جاهزة
    const warmHistory = async () => {
      for (let i = 0; i < PREFETCH_DEPTH; i++) {
        const { mode, id, history, fields, previewLang } = useEditor.getState()
        const doc = history.at(-1 - i)
        if (!doc || signal.aborted) return
        if (lookup(doc, previewLang, fields)) continue
        try {
          const payload = await fetchPreview(mode, id, doc, previewLang, signal, fields)
          rendered.set(doc, { lang: previewLang, fields, payload })
        } catch {
          return // التجهيز اختياري: لو فشل، التراجع بيطلب المعاينة بالطريقة العادية
        }
      }
    }
    const warmLater = () => setTimeout(() => void warmHistory(), PREFETCH_WAIT)

    // رجعنا لنسخة اتعرضت قبل كده (تراجع/إعادة)؟ نعرضها في نفس اللحظة
    const now = useEditor.getState()
    const cached = lookup(now.doc, now.previewLang, now.fields)
    if (cached) {
      useEditor.getState().setRenderedLang(cached.lang)
      sendToFrame(frame.current, { type: 'lb-editor:render', payload: cached, selected: now.selected, force: now.instantRev === rev })
      setBusy(false)
      const warm = warmLater()
      return () => {
        clearTimeout(warm)
        controller.abort()
      }
    }

    let warm: ReturnType<typeof setTimeout> | undefined
    // التراجع/الإعادة مالهمش وقفة كتابة نستناها: نطلب فوراً
    const wait = rev === 0 || now.instantRev === rev ? 0 : PREVIEW_WAIT
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        // بيانات المناسبة غير المحفوظة بتتبعت مع المستند: المعاينة تعكس تبويب «البيانات» قبل الحفظ
        const { mode, id, doc, fields, previewLang, selected: current } = useEditor.getState()
        const payload = await fetchPreview(mode, id, doc, previewLang, signal, fields)
        rendered.set(doc, { lang: previewLang, fields, payload })
        useEditor.getState().setRenderedLang(payload.lang)
        sendToFrame(frame.current, { type: 'lb-editor:render', payload, selected: current, force: now.instantRev === rev })
        setBusy(false)
        warm = warmLater()
      } catch (error) {
        if (signal.aborted) return
        setBusy(false)
        ui.toast(t('editor.toast.previewFailed'), 'error')
        console.error(error)
      }
    }, wait)
    return () => {
      clearTimeout(timer)
      clearTimeout(warm)
      controller.abort()
    }
  }, [rev, ready, t, ui])

  // العنصر المحدَّد جوّه قسم مستورد → علامته في الإطار
  const selEl = useEditor((s) => s.selEl)
  useEffect(() => {
    sendToFrame(frame.current, { type: 'lb-editor:element', id: selEl?.blockId ?? null, slot: selEl?.slot ?? null })
  }, [selEl, ready])

  // العنصر فوق القسم المحدَّد → علامته في الإطار
  const selOverlay = useEditor((s) => s.selOverlay)
  useEffect(() => {
    sendToFrame(frame.current, { type: 'lb-editor:overlay-pick', id: selOverlay?.blockId ?? null, index: selOverlay?.index ?? null })
  }, [selOverlay, ready])

  // نص اتكتب في خانة باللوحة → يظهر في المعاينة في نفس اللحظة (من غير ما نستنى السيرفر).
  // مانبعتش لو المعاينة معروضة بالنسخة المترجَمة: النص اللي هناك مش نص الدعوة.
  const lastText = useEditor((s) => s.lastText)
  useEffect(() => {
    if (!lastText || !ready) return
    const { doc, renderedLang } = useEditor.getState()
    if (renderedLang && renderedLang !== baseLangOf(doc)) return
    sendToFrame(frame.current, { type: 'lb-editor:patch', id: lastText.id, key: lastText.key, value: lastText.value })
  }, [lastText, ready])

  // تعديل من لوحة العنصر → يتطبّق على العقدة الحية لحظياً (الرسمة الجاية من السيرفر بتأكّده)
  const lastEdit = useEditor((s) => s.lastEdit)
  useEffect(() => {
    if (lastEdit && ready) sendToFrame(frame.current, { type: 'lb-editor:node', id: lastEdit.id, slot: lastEdit.slot, edit: lastEdit.edit })
  }, [lastEdit, ready])

  // زرار «الافتتاحية»: نبعت بس لما العدّاد يتغيّر بعد فتح المحرر (مش قيمته القديمة من فتحة سابقة)
  // إطار حدود القسم ومقبض ارتفاعه: للمقاس الحالي، وبيتحدّث مع الارتفاع المحفوظ
  const boundsBlock = useEditor((s) => s.boundsBlock)
  const heightKey = `section_height_${device}`
  const storedHeight = useEditor((s) => Number(s.doc.blocks.find((b) => b.id === s.boundsBlock)?.style[`section_height_${s.device}`] ?? 0))
  useEffect(() => {
    if (!ready) return
    const bounds = boundsBlock
      ? { id: boundsBlock, key: heightKey, label: `${t('editorInline.bounds.label')} · ${t(`editor.device.${device}`)}`, stored: storedHeight }
      : null
    sendToFrame(frame.current, { type: 'lb-editor:bounds', bounds })
  }, [boundsBlock, heightKey, storedHeight, device, ready, t])

  const introCount = useIntroBus((s) => s.count)
  const seenIntro = useRef(introCount)
  useEffect(() => {
    if (introCount === seenIntro.current) return
    seenIntro.current = introCount
    sendToFrame(frame.current, { type: 'lb-editor:intro' })
  }, [introCount])

  // زرار «تخطّي الافتتاحية»: نفس قاعدة العدّاد فوق
  const skipCount = useIntroBus((s) => s.skipCount)
  const seenSkip = useRef(skipCount)
  useEffect(() => {
    if (skipCount === seenSkip.current) return
    seenSkip.current = skipCount
    sendToFrame(frame.current, { type: 'lb-editor:intro-skip' })
  }, [skipCount])

  // المعاينة اتقفلت مع المحرر: ماتفضلش «الافتتاحية ظاهرة» في الستور لمرة تانية
  useEffect(() => () => useIntroBus.getState().setVisible(false), [])

  // التحديد بيتزامن من غير طلب جديد؛ التمرير للقسم بس لو الضغطة من القايمة
  useEffect(() => {
    sendToFrame(frame.current, { type: 'lb-editor:select', id: selected, scroll: selectSource === 'list' })
  }, [selected, selectSource, ready])

  return (
    <div className="ed-device" data-device={device} data-busy={busy || undefined}>
      <iframe ref={frame} src="/editor-frame/" title={t('editor.preview.title')} />
    </div>
  )
}
