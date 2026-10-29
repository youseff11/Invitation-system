import { defineConfig } from '@playwright/test'

/**
 * اختبارات التطابق البصري بين الموقع القديم وتطبيق React.
 *
 *   TARGET=legacy  → الصفحات على مساراتها القديمة (‎/‎، ‎/templates/‎ …)
 *   TARGET=react   → نفس الصفحات تحت ‎/app/‎
 *
 * اللقطات المرجعية بتتولّد مرة من القديم:
 *   TARGET=legacy npx playwright test --update-snapshots
 * وبعدها كل مرحلة بتقارن صفحاتها الجديدة بيها:
 *   TARGET=react npx playwright test
 *
 * محتاج Django شغّال على BASE_URL (افتراضي http://localhost:8000)، و
 * E2E_USER / E2E_PASSWORD لحساب من فريق العمل لصفحات اللوحة.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // اللقطة المرجعية لها نفس الاسم للهدفين — الفرق الوحيد هو المسار اللي بنفتحه.
  // اللقطات محلية ومش في Git (متصوّرة من قاعدة بيانات حقيقية والـrepo عام):
  // BASELINE_DIR بيخلّي جلسة على worktree تقرا لقطات الـcheckout الرئيسي.
  snapshotDir: process.env.BASELINE_DIR ?? 'e2e/baseline',
  snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8000',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    // الموقع بيظهر الأقسام تدريجياً بالحركة؛ مع تقليل الحركة بتظهر كلها فوراً
    // فاللقطة ثابتة. (والواجهة الجديدة لازم تحترم prefers-reduced-motion برضه.)
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'parity',
      testMatch: /parity\.spec\.ts/,
      dependencies: ['setup'],
    },
    { name: 'smoke', testMatch: /smoke\.spec\.ts/ },
  ],
})
