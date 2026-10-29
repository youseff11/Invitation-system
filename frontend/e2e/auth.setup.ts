import { expect, test as setup } from '@playwright/test'

import { STATE } from './pages'

/**
 * يسجّل دخول مرة واحدة ويحفظ الجلسة. بنستخدم فورم الموقع القديم في الحالتين:
 * الجلسة جلسة Django واحدة بتشتغل مع القديم ومع React.
 */

setup('login as staff', async ({ page }) => {
  const username = process.env.E2E_USER
  const password = process.env.E2E_PASSWORD
  if (!username || !password) {
    throw new Error('حدّد E2E_USER و E2E_PASSWORD (حساب من فريق العمل على قاعدة بيانات تجريبية).')
  }
  await page.goto('/login/')
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/dashboard\/?$/)
  await page.context().storageState({ path: STATE })
})
