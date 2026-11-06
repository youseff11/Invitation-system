import { createRoot } from 'react-dom/client'

import { InviteApp } from '@/features/invite/InviteApp'
import type { Boot } from '@/features/invite/types'
import '@/features/invite/invite.css'

/**
 * Entry منفصل وخفيف لصفحات الدعوة (‎/app/i/<slug>/‎ و‎/app/templates/<slug>/preview/‎):
 * مفيش لوحة تحكم ولا راوتر ولا react-query ولا i18next — الضيف على موبايل.
 * الحمولة جاية جوّه الصفحة (‎#invite-data‎) فمفيش طلب قبل الرسم.
 * من غير StrictMode عن قصد: الافتتاحية والموسيقى مستمعاتها native وبتتربط مرة.
 */
const node = document.getElementById('invite-data')
const boot = JSON.parse(node?.textContent || '{}') as Boot
const mount = () => createRoot(document.getElementById('root')!).render(<InviteApp boot={boot} />)

// ‎?lbdebug=1‎: لوحة تشخيص الفيديو على الشاشة (للآيفون من غير Web Inspector).
// بتتحمّل قبل الرسم عشان تلحق أول ‎play()‎، ومش بتدخل الحزمة العادية.
if (/[?&]lbdebug=1(?:&|$)/.test(window.location.search)) {
  import('@/features/invite/runtime/debug').then((m) => m.startDebug()).catch(() => {}).finally(mount)
} else {
  mount()
}
