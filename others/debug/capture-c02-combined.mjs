// others/debug/capture-c02-combined.mjs
// Drives the Docker frontend (:5180) with Playwright to capture C-02 combined-
// screen screenshots for the JA manual. Real Google Maps (key auto-loads from
// app/frontend/.env.local via VITE_GOOGLE_MAPS_KEY). NOT shipped; debug only.
//
//   node others/debug/capture-c02-combined.mjs
//
// Requires the htmlapp playwright + chromium already installed.
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
const log = (...a) => console.log('[capture]', ...a)

async function shot(page, name, locator) {
  const path = resolve(OUT, `${name}.png`)
  if (locator) {
    await locator.screenshot({ path })
  } else {
    await page.screenshot({ path, fullPage: false })
  }
  log('saved', name)
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2, // crisp/retina captures for zoom
  })
  const page = await context.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if (/error|fail/i.test(t)) log('page-console:', t)
  })

  log('goto', BASE)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })

  // Switch to the Combined (統合) screen — 3rd top-nav button.
  const combinedBtn = page.getByRole('button', { name: /統合|Combined/ })
  await combinedBtn.click()
  await page.waitForSelector('[data-testid="merged-shell"]', { timeout: 30000 })
  await sleep(1500)

  // 0. Full combined screen on default case (C-01) — the whole-screen overview.
  await shot(page, '00-overview-default')

  // Select C-02.
  log('select C-02')
  await page.selectOption('[data-testid="experience-case-select"]', CASE_ID)
  await sleep(3500) // let the case apply + map/quickview settle

  // Wait for the Google map to actually paint (gm-style / canvas / img tiles).
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="merged-map-surface"]')
    if (!el) return false
    return !!el.querySelector('.gm-style, canvas, img[src*="googleapis"], img[src*="gstatic"]')
  }, { timeout: 45000 }).catch(() => log('WARN: google map selector not detected; capturing anyway'))
  await sleep(4000) // tiles finish loading

  // 1. Full combined screen with C-02 selected.
  await shot(page, '01-c02-overview')

  // 2. Left panel — case card + setup.
  const left = page.locator('.left-panel')
  await shot(page, '02-left-panel', left)

  // 2b. Case card alone.
  await shot(page, '02b-case-card', page.locator('[data-testid="experience-case-card"]'))

  // 2c. Case fixed conditions.
  const fixed = page.locator('[data-testid="case-fixed-conditions"]')
  if (await fixed.count()) await shot(page, '02c-case-fixed', fixed)

  // 3. Center panel — map + playback (pre-run projection markers).
  const center = page.locator('.center-panel')
  await shot(page, '03-center-panel', center)
  await shot(page, '03b-map-surface', page.locator('[data-testid="merged-map-surface"]'))

  // 3c. Quickview strip (NRI curve) — used for recovery visualization too.
  const qv = page.locator('[data-testid="quickview-strip"]')
  if (await qv.count()) await shot(page, '03c-quickview-nri', qv)

  // 4. Right panel — review column (3 tabs).
  await shot(page, '04-review-column', page.locator('[data-testid="review-column"]'))

  // ── Run to a fired proposal ────────────────────────────────────────────
  log('press play')
  await page.locator('[data-testid="merged-play-button"]').click()

  // Wait until a rest proposal pauses the run (rest-accept-panel appears) or a
  // guided overlay shows. Poll up to ~90s of wall time.
  let fired = false
  for (let i = 0; i < 60; i++) {
    const restPanel = await page.locator('[data-testid="rest-accept-panel"]').count()
    const guided = await page.locator('[data-testid="guided-overlay"]').count()
    const recovery = await page.locator('[data-testid="recovery-picker"]').count()
    if (restPanel || guided || recovery) { fired = true; break }
    await sleep(1500)
  }
  log('fired proposal detected:', fired)
  await sleep(1500)

  if (fired) {
    // 5. Full screen at the fired proposal (map overlay + review).
    await shot(page, '05-proposal-fired-full')
    await shot(page, '05b-center-at-fire', center)
    const restPanel = page.locator('[data-testid="rest-accept-panel"]')
    if (await restPanel.count()) await shot(page, '05c-rest-accept-panel', restPanel)
    await shot(page, '05d-review-at-fire', page.locator('[data-testid="review-column"]'))

    // Choose the first rest spot to accept (drive→rest→recovery), if offered.
    const spotBtns = page.locator('[data-testid="rest-accept-panel"] button')
    if (await spotBtns.count()) {
      log('accepting first rest spot')
      await spotBtns.first().click()
      await sleep(2500)
      await shot(page, '06-after-accept-full')
      await shot(page, '06b-center-after-accept', center)
    }

    // Continue playing to visualize recovery (score drop) if possible.
    const playBtn = page.locator('[data-testid="merged-play-button"]')
    if (await playBtn.isEnabled().catch(() => false)) {
      await playBtn.click()
      await sleep(6000)
      await shot(page, '07-recovery-progress-full')
      const qv2 = page.locator('[data-testid="quickview-strip"]')
      if (await qv2.count()) await shot(page, '07b-quickview-recovery', qv2)
    }
  }

  // ── Hybrid quickview for the recovery appendix (switch trigger pkg) ──────
  try {
    log('reset + switch trigger to hybrid for quickview')
    const reset = page.locator('[data-testid="merged-reset-button"]')
    if (await reset.isEnabled().catch(() => false)) { await reset.click(); await sleep(1500) }
    const trig = page.locator('[data-testid="merged-trigger-package-select"]')
    const opts = await trig.locator('option').all()
    for (const o of opts) {
      const val = await o.getAttribute('value')
      if (val && /hybrid/i.test(val)) { await trig.selectOption(val); break }
    }
    await sleep(3500)
    const qv3 = page.locator('[data-testid="quickview-strip"]')
    if (await qv3.count()) await shot(page, '08-quickview-hybrid', qv3)
    await shot(page, '08b-center-hybrid', page.locator('.center-panel'))
  } catch (e) {
    log('hybrid quickview step skipped:', e.message)
  }

  await browser.close()
  log('DONE — shots in', OUT)
}

run().catch((e) => { console.error(e); process.exit(1) })
