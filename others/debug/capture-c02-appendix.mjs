// others/debug/capture-c02-appendix.mjs
// Follow-up capture for the JA manual's Appendix A: the two setup popups that
// illustrate the algorithm changes —
//   (1) Situation → Detailed → RouteConditionsPainter (jam / mountain km bands)
//   (2) Driver profile → Detailed → PreferenceHistorySection (multi-oshi + score)
//   (3) Content proposal candidate with feature trace expanded (oshi affinity)
// Drives the Docker frontend (:5180) with Playwright. NOT shipped; debug only.
//
//   node others/debug/capture-c02-appendix.mjs
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pwPath = resolve(process.cwd(), 'htmlapp/frontend/node_modules/playwright/index.js')
const pw = await import(pathToFileURL(pwPath).href)
const chromium = pw.chromium ?? pw.default?.chromium

const BASE = process.env.BASE_URL || 'http://localhost:5180'
const OUT = resolve(process.cwd(), 'others/debug/combined-shots')
const CASE_ID = 'case-c02-night-highway-drowsiness'
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[appendix]', ...a)

async function shot(page, name, locator) {
  const path = resolve(OUT, `${name}.png`)
  if (locator) await locator.screenshot({ path })
  else await page.screenshot({ path, fullPage: false })
  log('saved', name)
}

// Click the "▸ 詳細設定" toggle inside the open modal to reveal the detailed tier.
async function openDetailed(page) {
  const toggle = page.locator('[data-testid="setup-detailed-toggle"]')
  if (await toggle.count()) { await toggle.first().click(); await sleep(900) }
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage()

  log('goto', BASE)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByRole('button', { name: /統合|Combined/ }).click()
  await page.waitForSelector('[data-testid="merged-shell"]', { timeout: 30000 })
  await sleep(1200)
  await page.selectOption('[data-testid="experience-case-select"]', CASE_ID)
  await sleep(3000)

  // (1) Situation popup → detailed → route-conditions painter (jam/mountain).
  log('open situation edit → detailed')
  await page.locator('[data-testid="edit-situation"]').click()
  await sleep(800)
  await openDetailed(page)
  // The painter lives well down the modal; screenshot the whole modal, and the
  // painter alone if it exposes a testid.
  const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first()
  if (await modal.count()) await shot(page, 'A1-situation-detailed', modal)
  else await shot(page, 'A1-situation-detailed')
  const painter = page.locator('[data-testid="route-conditions-painter"]')
  if (await painter.count()) await shot(page, 'A1b-route-painter', painter)
  // Close the modal.
  await page.keyboard.press('Escape'); await sleep(600)

  // (2) Driver profile popup → detailed → preference/history (oshi artists).
  log('open profile edit → detailed')
  await page.locator('[data-testid="edit-profile"]').click()
  await sleep(800)
  await openDetailed(page)
  const modal2 = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first()
  if (await modal2.count()) await shot(page, 'A2-profile-detailed', modal2)
  else await shot(page, 'A2-profile-detailed')
  await page.keyboard.press('Escape'); await sleep(600)

  // (3) Content proposal — expand a candidate's feature trace to show oshi.
  log('expand content feature trace')
  // The content candidates show a "▶ 特徴量トレース" / "この候補の理由" toggle.
  const trace = page.getByText(/特徴量トレース|この候補の理由/).first()
  if (await trace.count()) {
    await trace.scrollIntoViewIfNeeded().catch(() => {})
    await trace.click().catch(() => {})
    await sleep(700)
    const rightPanel = page.locator('.right-panel, [data-testid="review-column"]').first()
    // The content proposal card is in the CENTER panel's content column.
    const contentCol = page.getByText('② コンテンツ提案').locator('xpath=ancestor::*[1]')
    await shot(page, 'A3-content-trace')
  }

  await browser.close()
  log('DONE — shots in', OUT)
}

run().catch((e) => { console.error(e); process.exit(1) })
