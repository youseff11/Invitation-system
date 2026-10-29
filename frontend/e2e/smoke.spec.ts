import { expect, test } from '@playwright/test'

/**
 * فحص سريع إن الـshell بيشتغل: ‎/app/‎ بيفتح، الـAPI بيرد، وlogin بيحمي اللوحة.
 * بيشتغل من غير أي بيانات أو لقطات مرجعية.
 */
test('the React shell boots and renders the site name', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/app/')
  await expect(page.locator('#root h1')).toBeVisible()
  await expect(page.locator('script#boot-data')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('the dashboard route sends anonymous visitors to the React login page', async ({ page }) => {
  await page.goto('/app/dashboard')
  await expect(page).toHaveURL(/\/app\/login$/)
  await expect(page.locator('form input[name="username"]')).toBeVisible()
})

test('the API answers JSON and rejects a POST without a CSRF token', async ({ request }) => {
  const site = await request.get('/api/v1/site/')
  expect(site.ok()).toBeTruthy()
  expect((await site.json()).languages.length).toBe(2)
  const bad = await request.post('/api/v1/auth/login/', { data: {} })
  expect(bad.status()).toBe(403) // من غير CSRF
})
