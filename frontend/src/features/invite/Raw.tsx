import { useLayoutEffect, useRef, type CSSProperties } from 'react'

import { runSectionScripts } from './runtime/code-roots'

const CONTENTS: CSSProperties = { display: 'contents' }

/**
 * HTML جاهز من السيرفر (متنقّى هناك). الغلاف ‎display: contents‎ فمايأثّرش على
 * التخطيط. سكربتات «كود متقدّم» (‎data-lb-section-script‎) بتتنفّذ بعد الحقن
 * لأن ‎innerHTML‎ مابيشغّلش السكربتات.
 */
export function Raw({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current && html) runSectionScripts(ref.current)
  }, [html])
  if (!html) return null
  return <div ref={ref} style={CONTENTS} dangerouslySetInnerHTML={{ __html: html }} />
}
