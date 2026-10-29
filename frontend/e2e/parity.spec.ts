import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect, type Page } from '@playwright/test'

import { STATE, TARGET, buildPages, urlFor, type PageDef, type Variant } from './pages'

const BASELINE_DIR = process.env.BASELINE_DIR ?? 'e2e/baseline'

/** تاريخ ثابت عشان العدّادات التنازلية والتواريخ النسبية تطلع نفس اللقطة كل مرة. */
const FROZEN_NOW = new Date('2026-10-23T12:00:00+03:00')

async function prepare(page: Page, variant: Variant) {
  await page.context().addCookies([
    {
      name: 'django_language',
      value: variant.lang,
      url: new URL(test.info().project.use.baseURL ?? 'http://localhost:8000').origin,
    },
  ])
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem('leila-theme', theme)
    } catch {
      /* التخزين ممنوع */
    }
  }, variant.theme)
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.setViewportSize(variant.viewport)
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  // الأقسام بتظهر تدريجياً لما تدخل الشاشة (IntersectionObserver) — لقطة الصفحة
  // الكاملة من غير سكرول كانت بتطلع بفراغات. بنمرّ على الصفحة كأن زائر بينزل بيها.
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.7)
    const height = () => document.documentElement.scrollHeight
    for (let y = 0; y < height(); y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle').catch(() => {})
  // استقرار بصري بعد الرجوع لأعلى الصفحة (مش انتظار على شرط معيّن)
  await page.waitForTimeout(700)
}

const pages = buildPages()

for (const def of pages) {
  const runs: [PageDef, Variant][] = def.variants.map((v) => [def, v])
  for (const [pageDef, variant] of runs) {
    test.describe(pageDef.id, () => {
      test.skip(TARGET === 'react' && !pageDef.ported, 'الصفحة لسه ماتنقلتش لـReact')
      if (pageDef.staff) test.use({ storageState: STATE })

      test(variant.name, async ({ page }) => {
        const snapshot = `${pageDef.id}.${variant.name}.png`
        // لقطة مفقودة = Playwright كان هيكتب لقطة جديدة من React ويعتبرها مرجعاً.
        // نوقف ده: المرجع لازم يتولّد من الموقع القديم بس.
        // Playwright بيحفظ اللقطة باسم منظَّف (النقطة بتتحوّل لشرطة: a.b.png → a-b.png)
        const onDisk = snapshot.replace(/\.png$/, '').replace(/[^\w-]+/g, '-') + '.png'
        if (TARGET === 'react' && !existsSync(join(BASELINE_DIR, onDisk))) {
          throw new Error(
            `اللقطة المرجعية ${snapshot} مش موجودة في ${BASELINE_DIR}. ` +
              'ولّدها من الموقع القديم: TARGET=legacy npx playwright test --project=parity --update-snapshots',
          )
        }
        await prepare(page, variant)
        const response = await page.goto(urlFor(pageDef))
        expect(response?.status(), `${urlFor(pageDef)} status`).toBeLessThan(400)
        await settle(page)
        await expect(page).toHaveScreenshot(snapshot, { fullPage: true })
      })
    })
  }
}
