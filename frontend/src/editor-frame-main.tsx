import { createRoot } from 'react-dom/client'

import { FrameApp } from '@/features/editor/frame/FrameApp'
import '@/features/invite/invite.css'
import '@/features/editor/frame/frame.css'

/**
 * Entry إطار معاينة المحرر (‎/editor-frame/‎): بيعرض حمولة الدعوة اللي الصفحة الأم بتبعتها
 * بـpostMessage. Entry تالت منفصل عشان حزمة الضيف (invite-main) ماتكبرش بكود المحرر.
 */
createRoot(document.getElementById('root')!).render(<FrameApp />)
