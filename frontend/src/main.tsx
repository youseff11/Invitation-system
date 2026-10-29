import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import { boot } from '@/app/boot'
import { initI18n } from '@/i18n'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/app.css'

initI18n(boot.lang)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
