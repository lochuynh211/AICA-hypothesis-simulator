// others/debug/capture-c02-oshi.mjs
// Captures the multi-oshi + 熱狂度 (enthusiasm) editor for Appendix A: opens the
// Driver-profile popup, goes Detailed, adds two oshi-artist rows, and shoots the
// oshi block so the manual can show "multiple artists, each with a favourite
// score". NOT shipped; debug only.  node others/debug/capture-c02-oshi.mjs
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
const log = (...a) => console.log('[oshi]', ...a)

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByRole('button', { name: /統合|Combined/ }).click()
  await page.waitForSelector('[data-testid="merged-shell"]', { timeout: 30000 })
  await sleep(1200)
  await page.selectOption('[data-testid="experience-case-select"]', CASE_ID)
  await sleep(3000)

  await page.locator('[data-testid="edit-profile"]').click()
  await sleep(700)
  await page.locator('[data-testid="setup-detailed-toggle"]').first().click()
  await sleep(900)

  // Add two oshi-artist rows.
  const addBtn = page.locator('[data-testid="oshi-artist-add"]')
  for (let i = 0; i < 2; i++) {
    if (await addBtn.isEnabled().catch(() => false)) { await addBtn.click(); await sleep(500) }
  }
  // Pick an artist in each row if the select has options; set differing scores.
  for (let idx = 0; idx < 2; idx++) {
    const sel = page.locator(`[data-testid="oshi-artist-select-${idx}"]`)
    if (await sel.count()) {
      const opts = await sel.locator('option').all()
      // option[0] is usually the placeholder; pick a real artist.
      const pick = opts[Math.min(idx + 1, opts.length - 1)]
      const val = pick ? await pick.getAttribute('value') : null
      if (val) await sel.selectOption(val).catch(() => {})
    }
    const slider = page.locator(`[data-testid="oshi-artist-enthusiasm-${idx}"]`)
    if (await slider.count()) {
      // 1.0 for the first (top oshi), 0.6 for the second — shows the score varies.
      await slider.fill(idx === 0 ? '1' : '0.6').catch(() => {})
    }
    await sleep(300)
  }
  await sleep(600)

  const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first()
  if (await modal.count()) await shot(page, 'A2b-oshi-multi', modal)
  else await shot(page, 'A2b-oshi-multi')

  await browser.close()
  log('DONE')

  function shot(p, name, loc) {
    const path = resolve(OUT, `${name}.png`)
    const target = loc ? loc.screenshot({ path }) : p.screenshot({ path, fullPage: false })
    return target.then(() => log('saved', name))
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
