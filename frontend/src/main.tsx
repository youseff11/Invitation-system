import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import { initI18n } from '@/i18n'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/app.css'

// الموقع عربي بس — الترجمة اتشالت
initI18n('ar')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
