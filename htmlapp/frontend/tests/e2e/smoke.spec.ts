import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// package.json has "type": "module", so this file runs as an ES module and
// __dirname is not defined — derive it from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * S4.4 file:// smoke test — the M-S4 shippable-artifact gate.
 *
 * UPDATED (S9.3 milestone): this smoke's original scope (see git history —
 * task-S4.4-report.md) deliberately stopped at "Preview Plan surfaces a
 * clean setup-error", for TWO reasons that no longer hold:
 *   1. `routesAnalyze` in `src/api/client.ts` was a stub at S4.4 time; it is
 *      now fully implemented (local + Maps paths — see its module doc
 *      comment / S7.3), so "Preview Plan" now succeeds instead of failing.
 *   2. Both bundled packages were `algorithm.type: "python_module"`, which
 *      `src/engine/algorithms/adapter.ts` did not support — every tick would
 *      raise `unsupported_algorithm_type` and pause the run immediately.
 *      S9.3 ports `nri_fatigue_score_v1`'s `algorithm.py` to a trusted TS
 *      `builtin_js_module` (`src/data/packages/builtin/nri_fatigue_score_v1.ts`)
 *      and wires the adapter's dispatch seam to it, so the bundled
 *      `nri_fatigue_score_v1` package now runs a full scenario to
 *      completion offline.
 *
 * This smoke now drives the FULL flow end to end over `file://` — setup ->
 * preview -> start run -> tick loop (resolving every REST_PROPOSAL pause via
 * the M7 RecoveryPicker UI) -> completion — and asserts:
 *   1. The built dist/index.html loads over file:// and renders the app.
 *   2. The setup screen's package + scenario pickers are populated from the
 *      IndexedDB-seeded defaults.
 *   3. Preview Plan succeeds (plan-summary appears) and Start Run transitions
 *      to the Review screen.
 *   4. Stepping through ticks produces REAL decisions (REST_PROPOSAL fires
 *      and pauses the run repeatedly; NEVER an algorithm_error), and the run
 *      genuinely reaches `status: 'completed'` — verified via the Runs
 *      screen's persisted run list (see the completion-detection note below
 *      for why that channel, not the live Review screen, is the reliable
 *      completion signal here).
 *   5. THE SELF-CONTAINMENT INVARIANT: zero unexpected external network
 *      requests for this whole flow — only file://, data:, and blob: are
 *      allowed (the local route/rest-spot paths never call Google Maps; no
 *      Maps key is entered in this test).
 *
 * `aica_transparent_hybrid_trigger_v1` (the OTHER bundled python_module
 * package) remains UNPORTED — deliberately out of scope for S9.3 — so it is
 * not exercised here.
 *
 * NOTE: the BINDING proof for the S9.3 milestone is
 * `tests/client_run_loop.test.ts`'s vitest test (same flow, driven directly
 * through the `src/api/client.ts` seam rather than the DOM — faster, and not
 * dependent on a Chromium install or the UI quirks noted below). This
 * Playwright spec is the UI-level confirmation that the same offline run
 * also completes through the real rendered app.
 */

const DIST = pathToFileURL(resolve(__dirname, '..', '..', 'dist', 'index.html')).href

test('offline bundle loads over file://, drives nri_fatigue_score_v1 to completion, stays self-contained', async ({ page }) => {
  test.setTimeout(180_000)

  const externalRequests: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) {
      externalRequests.push(u)
    }
  })

  await page.goto(DIST)

  // 1. App loaded — title set (index.html <title>) and the Setup screen rendered.
  await expect(page).toHaveTitle(/AICA Hypothesis Simulator/i)
  await expect(page.getByTestId('setup-screen')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Run Setup/i })).toBeVisible()

  // 2. Package + Scenario pickers populated from IndexedDB-seeded defaults.
  //    Select by VALUE (the package/scenario id) rather than option index —
  //    robust to registry ordering.
  const packageSelect = page.locator('#package-select')
  const scenarioSelect = page.locator('#scenario-select')
  await expect(packageSelect).toBeEnabled()
  await expect(scenarioSelect).toBeEnabled()
  await packageSelect.selectOption('nri_fatigue_score_v1')
  await scenarioSelect.selectOption('uc01_fatigue_recovery_v0_1')

  // 3. Preview Plan — now succeeds (routesAnalyze's local path is fully
  //    implemented): plan-summary appears, no setup-error.
  await page.getByRole('button', { name: 'Preview Plan' }).click()
  await expect(page.getByTestId('plan-summary')).toBeVisible()
  await expect(page.getByTestId('setup-error')).toHaveCount(0)

  // 4. Start Run — auto-transitions to the Review screen (RUN_CREATED).
  await page.getByRole('button', { name: 'Start Run' }).click()
  await expect(page.getByTestId('review-screen')).toBeVisible()

  // 5. Tick loop: click Step repeatedly; resolve the RecoveryPicker overlay
  //    every time the run pauses on a fired REST_PROPOSAL.
  //
  //    NOTE 1 (discovered running this spec — pre-existing, out of scope for
  //    S9.3): getRestSpots's "ahead of the current position" filter in
  //    src/api/client.ts uses a STRICT `pos > currentDistanceKm` — this
  //    scenario/package pairing's only rest facility sits exactly where the
  //    first REST_PROPOSAL fires, so `spots.length` is 0 for this run's
  //    proposals and every non-postpone recovery option (incl.
  //    accept_rest/nap_karaoke) stays disabled; only Postpone/Decline are
  //    ever clickable through the DOM here. accept_rest IS exercised (with a
  //    synthetic rest spot) by the binding proof, tests/client_run_loop.test.ts,
  //    which drives the same package/scenario through src/api/client.ts
  //    directly, bypassing this UI-only quirk. This spec accepts whichever
  //    recovery option is actually enabled (nap_karaoke if ever offered,
  //    else decline) — completion + zero algorithm_error is what it exists
  //    to prove at the UI layer.
  //
  //    NOTE 2 (also discovered running this spec — pre-existing, out of
  //    scope for S9.3): once a package genuinely reaches the true end of a
  //    route, the tick engine's early-completion branch returns a "no-op"
  //    tick response (`decision: null, completed: true` —
  //    src/engine/run_manager.ts's `tick()`, the `runState.status ===
  //    'completed'` guard and the earlier `tickState.completed` early exit).
  //    `PlaybackControls.tsx`'s `doTick()` has a dedicated branch for this
  //    exact response shape, but that branch only calls `setIsPlaying(false)`
  //    — it never dispatches anything to flip `state.completed` in the
  //    store. So the LIVE Review screen's `run-feedback-section` (gated on
  //    `state.completed`) never appears for a run that completes via this
  //    no-op path, even though the run's persisted `RunState.status` (and
  //    its `runs` header row) IS genuinely `'completed'` — this is a real,
  //    latent gap in the untested "completed no-op" UI branch, apparently
  //    never before exercised because no bundled package could run a
  //    scenario to completion before S9.3. Fixing PlaybackControls.tsx is
  //    out of scope here (not in this task's edit list) — worked around
  //    below by verifying completion through the Runs screen's persisted
  //    run list instead of the live Review screen.
  let sawPause = false
  for (let i = 0; i < 300; i++) {
    const recoveryPicker = page.getByTestId('recovery-picker')
    if (await recoveryPicker.isVisible({ timeout: 300 }).catch(() => false)) {
      sawPause = true
      const napOption = page.getByTestId('recovery-option-nap_karaoke')
      const declineBtn = page.getByTestId('recovery-option-decline')
      if (await napOption.isEnabled({ timeout: 300 }).catch(() => false)) {
        await napOption.click({ timeout: 3000 }).catch(() => {})
      } else if (await declineBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await declineBtn.click({ timeout: 3000 }).catch(() => {})
      }
      await page.waitForTimeout(150)
      continue
    }

    if (await page.getByText('Algorithm Error').isVisible({ timeout: 100 }).catch(() => false)) {
      break // fail fast — asserted below
    }

    const stepBtn = page.getByRole('button', { name: 'Step' })
    if (await stepBtn.isEnabled({ timeout: 300 }).catch(() => false)) {
      await stepBtn.click({ timeout: 800 }).catch(() => {})
      await page.waitForTimeout(80)
    } else {
      await page.waitForTimeout(50)
    }
  }

  expect(sawPause, 'the run must have paused on at least one fired REST_PROPOSAL').toBe(true)

  // Never a faked/absent decision path: the live decision trace shows real
  // result types, never an unsupported_algorithm_type failure or an
  // "Algorithm Error" row.
  await expect(page.getByText('unsupported_algorithm_type')).toHaveCount(0)
  await expect(page.getByText('Algorithm Error')).toHaveCount(0)
  await expect(page.getByText('REST_PROPOSAL').first()).toBeVisible()

  // 6. Completion — verified via the Runs screen's persisted run list (see
  //    NOTE 2 above for why the live Review screen's completion indicator
  //    is not used here). This is the milestone proof at the UI layer: the
  //    bundled nri_fatigue_score_v1 package ran a full scenario to
  //    completion offline, entirely through the rendered app.
  await page.getByRole('button', { name: 'Runs' }).click()
  await expect(page.getByTestId('runs-screen')).toBeVisible()
  const runRow = page.locator('[data-testid^="run-row-"]')
  await expect(runRow).toHaveCount(1)
  await expect(runRow).toContainText('completed')

  // 7. Self-containment invariant: no unexpected external requests were made
  //    across the ENTIRE flow (setup, preview, run, rest-spot lookup, tick
  //    loop to completion, Runs screen) — no Maps key was entered, so the
  //    local route + synthetic rest-spot paths are exercised, never Google
  //    Maps.
  expect(externalRequests, `unexpected external requests: ${externalRequests.join(', ')}`).toHaveLength(0)
})
