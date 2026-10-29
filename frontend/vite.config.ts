import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const DJANGO = process.env.DJANGO_ORIGIN ?? 'http://127.0.0.1:8000'
// منفذ مخصص لكل جلسة شغل متوازي (VITE_PORT) — لازم يطابق VITE_DEV_SERVER في Django
const PORT = Number(process.env.VITE_PORT ?? 5173)

// أثناء التطوير Django هو اللي بيقدّم الصفحة (الـshell) وبيحمّل السكربتات من
// هنا بالـHMR؛ وقت الـbuild الملفات بتطلع في static/app/ وDjango بيقراها من
// manifest.json (شوف system/templatetags/vite.py).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/app/' : '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
    // روابط الملفات لازم تبقى مطلقة لأن الصفحة نفسها جاية من منفذ Django
    origin: `http://localhost:${PORT}`,
    // لو فتحت 5173 مباشرة (من غير shell) الطلبات بتتحوّل لـDjango
    proxy: {
      '/api': DJANGO,
      '/media': DJANGO,
      '/i18n': DJANGO,
      '/static/images': DJANGO,
      '/static/img': DJANGO,
      '/site-logo': DJANGO,
      '/site-icon.png': DJANGO,
      '/favicon.ico': DJANGO,
    },
  },
  build: {
    outDir: '../static/app',
    emptyOutDir: true,
    manifest: 'manifest.json',
    // entry منفصل لصفحة الدعوة: الضيف على موبايل ومايحتاجش لوحة التحكم ولا الراوتر
    // ولا react-query/i18next. Django بيختار الـentry بوسم {% vite_assets 'src/…' %}.
    // editorFrame: إطار معاينة المحرر (iframe) — بيستخدم مكوّنات الدعوة من غير حزمة الضيف.
    rollupOptions: {
      input: { main: 'src/main.tsx', invite: 'src/invite-main.tsx', editorFrame: 'src/editor-frame-main.tsx' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}))
