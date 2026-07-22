/**
 * S8 build smoke — verify both build modes render the setup screen.
 *
 * 1. Served build (worker mode): opened via http://localhost:4174 (vite preview)
 *    — the Web Worker backend is available in this mode.
 * 2. file:// build (in-process fallback): opened directly as file:///…/dist/index.html
 *    — workers cannot be constructed from file:// origins, so the InProcessTransport
 *    fallback activates automatically (see src/api/transport.ts).
 *
 * Each test asserts only that the setup screen renders (h1 "Run Setup" is visible),
 * which is the minimum proof that the bundled artifact is coherent.
 */

import { test, expect } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = resolve(__dirname, '..', '..', 'dist')

test('served build renders setup screen (worker mode)', async ({ page }) => {
  // playwright.config webServer serves dist/ on port 4174; baseURL is set to that.
  await page.goto('/')
  // The SetupScreen renders an h1 with text "Run Setup" (data-testid="setup-screen").
  await expect(page.getByRole('heading', { name: /Run Setup/i })).toBeVisible({ timeout: 10_000 })
})

test('file:// build renders setup screen (in-process fallback)', async ({ page }) => {
  // Open the built artifact directly from the filesystem.
  // Workers cannot be created from file:// origins, so InProcessTransport activates.
  const fileUrl = pathToFileURL(resolve(dist, 'index.html')).href
  await page.goto(fileUrl)
  // Same assertion — the setup screen must render regardless of transport mode.
  await expect(page.getByRole('heading', { name: /Run Setup/i })).toBeVisible({ timeout: 10_000 })
})
