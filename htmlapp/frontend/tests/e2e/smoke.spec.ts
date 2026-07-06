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
 *
 * S9.4 EXTENSION — surface-by-surface e2e coverage (final verification gate).
 * This single continuous run now ALSO drives, against the same rendered app
 * and inside the same self-containment check:
 *   - Feedback capture: opens the DecisionTracePanel's per-tick "Give
 *     feedback" affordance (`feedback-toggle-tick-{tick_index}`) on the
 *     first recorded decision, submits FeedbackForm with target `{ scope:
 *     'decision', tick_index }` (S5.1's resolveEventRef tick_index anchor),
 *     and asserts acceptance (`feedback-success`).
 *   - Replay: after completion, selects the run row on the Runs screen and
 *     drives ReplayViewer/ReplayControls (Prev/Next around
 *     `replay-current-tick`) to the EXACT tick_index the feedback was
 *     submitted against, asserting `replay-decision-trace` renders a real
 *     decision purely from the persisted log
 *     (`src/replay/replaySource.ts` — no engine recalculation).
 *   - Feedback persistence: loads RunLogViewer's on-demand timeline (`Load`)
 *     and asserts the append-only log contains a distinct `timeline-feedback`
 *     row whose detail references the same tick_index — proving the
 *     feedback's target round-tripped store -> submitFeedback -> IndexedDB
 *     log -> read-only replay/timeline, not just the live in-memory store.
 *
 * Two surfaces have NO UI to drive at all (confirmed by grepping `src/` for
 * their client functions — no component calls either) and are intentionally
 * left as `test.skip` documentation entries below rather than faked
 * assertions:
 *   - Export/import round-trip (`src/engine/services/portability.ts`,
 *     `exportPortable`/`importPortable`) — seam-only; covered by
 *     `tests/portability.test.ts` (unit, `npm test`).
 *   - `js_module` package upload (`addUserPackage` in `src/api/client.ts`)
 *     — seam-only; covered by `tests/add_package.test.ts` (unit, `npm
 *     test`). Running an uploaded `js_module` package through the tick loop
 *     is a separate, deferred piece of work not asserted anywhere.
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

  // 2. Feature 009 setup flow — forced order Route → Scenario → Package
  //    (StepGate: scenario gated behind a selected route, package behind a
  //    selected scenario). Select by VALUE, robust to registry ordering.

  // 2a. Step 1 · Route — pick the first bundled route preset (local path,
  //     never touches Google Maps).
  const presetSelect = page.locator('#route-preset')
  await expect(presetSelect).toBeVisible()
  const presetValues = await presetSelect
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
  expect(presetValues.length, 'bundled route presets must be seeded').toBeGreaterThan(0)
  await presetSelect.selectOption(presetValues[0])

  // 2b. Step 2 · Scenario — unlocks once a route is selected.
  const scenarioSelect = page.locator('#scenario-select')
  await expect(scenarioSelect).toBeEnabled({ timeout: 10_000 })
  await scenarioSelect.selectOption('uc01_fatigue_recovery_v0_1')

  // 2c. Step 3 · Package — unlocks once a scenario is selected.
  const packageSelect = page.locator('#package-select')
  await expect(packageSelect).toBeEnabled({ timeout: 10_000 })
  await packageSelect.selectOption('nri_fatigue_score_v1')

  // 3. Instant Result — the ephemeral, non-persisting preview recomputes
  //    headlessly on every setup change (feature 009 US1). The strip renders a
  //    real result (not the empty/error state) and enables "Open full run".
  await expect(page.getByTestId('instant-result-strip')).toBeVisible()
  await expect(page.getByTestId('instant-result-open-full-run')).toBeEnabled({ timeout: 10_000 })

  // 4. Open full run — freezes exactly this setup into a persisted run and
  //    transitions to the Review screen (RUN_CREATED).
  await page.getByTestId('instant-result-open-full-run').click()
  await expect(page.getByTestId('review-screen')).toBeVisible()

  // 4a. FEEDBACK CAPTURE surface (S9.4): step once to produce the first
  //     recorded decision, then drive the DecisionTracePanel's per-tick
  //     "Give feedback" affordance end to end through the real UI. All
  //     FeedbackForm fields are optional (M5 T008), so submitting with none
  //     filled proves the bare-minimum `{ scope: 'decision', tick_index }`
  //     target — the S5.1 resolveEventRef tick_index anchor — is accepted.
  //     `feedbackTickIndex` is captured here and reused below (step 8/9) to
  //     prove the SAME tick_index survives into the persisted log and its
  //     read-only replay/timeline views.
  await expect(page.getByRole('button', { name: 'Step' })).toBeEnabled({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Step' }).click()

  const feedbackToggle = page.locator('[data-testid^="feedback-toggle-tick-"]').first()
  await expect(feedbackToggle).toBeVisible({ timeout: 10_000 })
  const toggleTestId = (await feedbackToggle.getAttribute('data-testid'))!
  const feedbackTickIndex = Number(toggleTestId.replace('feedback-toggle-tick-', ''))
  expect(Number.isFinite(feedbackTickIndex), `unparseable testid: ${toggleTestId}`).toBe(true)
  await feedbackToggle.click()

  const feedbackFormWrap = page.getByTestId(`decision-feedback-form-tick-${feedbackTickIndex}`)
  await expect(feedbackFormWrap).toBeVisible()
  await feedbackFormWrap.getByRole('button', { name: /Submit feedback/i }).click()
  // NOTE (discovered running this spec — pre-existing, out-of-scope synced
  // behavior, same class as the PlaybackControls/getRestSpots quirks noted
  // below): TraceEntryRow (src/components/trace/DecisionTracePanel.tsx)
  // passes `onSuccess={() => setFeedbackOpen(false)}` to FeedbackForm, which
  // fires synchronously the moment submitFeedback resolves — this collapses
  // the `decision-feedback-form-tick-N` wrapper (and the `feedback-success`
  // node nested inside it) before a spec can ever observe that node. A
  // *failed* submit (validation or network) never calls onSuccess, so it
  // leaves the wrapper open with `feedback-validation-errors` /
  // `feedback-submit-error` visible instead — so "the wrapper becomes
  // hidden" is itself a valid, non-faked signal of acceptance here. The
  // DURABLE proof of acceptance is step 9 below, which reads the persisted
  // RunLogViewer timeline for a `timeline-feedback` row targeting this exact
  // tick_index — accepted, not just submitted.
  await expect(feedbackFormWrap).toBeHidden({ timeout: 10_000 })

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

  // 8. REPLAY surface (S9.4): select the completed run's row — RunsScreen
  //    mounts ReplayViewer (auto-fetches getRunLog on mount, S7) read-only
  //    from the persisted log. Seek Prev/Next to the EXACT tick_index the
  //    feedback above was submitted against, and assert the replay renders
  //    a real decision at that tick purely from the log (replaySource.ts
  //    does no engine recalculation — see its module doc comment).
  await runRow.click()
  const pastRunEvidence = page.getByTestId('past-run-evidence')
  await expect(pastRunEvidence).toBeVisible()

  const replayControls = pastRunEvidence.getByTestId('replay-controls')
  await expect(replayControls).toBeVisible({ timeout: 10_000 })
  const replayCurrentTick = replayControls.getByTestId('replay-current-tick')

  async function currentReplayTick(): Promise<number> {
    const txt = (await replayCurrentTick.textContent()) ?? ''
    const m = txt.match(/tick#(-?\d+)/)
    return m ? Number(m[1]) : NaN
  }
  let seekGuard = 0
  while ((await currentReplayTick()) < feedbackTickIndex && seekGuard < 500) {
    await replayControls.getByRole('button', { name: 'Next tick' }).click()
    seekGuard++
  }
  while ((await currentReplayTick()) > feedbackTickIndex && seekGuard < 500) {
    await replayControls.getByRole('button', { name: 'Previous tick' }).click()
    seekGuard++
  }
  await expect(replayCurrentTick).toHaveText(`tick#${feedbackTickIndex}`)
  await expect(pastRunEvidence.getByTestId('replay-decision-trace')).toBeVisible()
  await expect(pastRunEvidence.getByTestId('replay-decision-trace')).toContainText(
    `tick#${feedbackTickIndex}`,
  )

  // 9. FEEDBACK PERSISTENCE surface (S9.4): RunLogViewer loads the same
  //    append-only log on demand (explicit "Load" — not auto-fetched) and
  //    must show a distinct HUMAN REVIEW / Feedback row whose detail
  //    references the same tick_index — proving the decision-scoped
  //    feedback submitted in step 4a round-tripped through submitFeedback
  //    into IndexedDB storage and back out through the read-only timeline.
  await pastRunEvidence.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(pastRunEvidence.getByTestId('runlog-content')).toBeVisible()
  await expect(pastRunEvidence.getByTestId(`timeline-tick-${feedbackTickIndex}`)).toBeVisible()
  await expect(pastRunEvidence.getByTestId('timeline-feedback')).toHaveCount(1)
  await pastRunEvidence.getByTestId('timeline-expand-feedback-0').click()
  await expect(pastRunEvidence.getByTestId('timeline-feedback-detail-0')).toContainText(
    `tick#${feedbackTickIndex}`,
  )

  // 10. Self-containment invariant: no unexpected external requests were made
  //     across the ENTIRE flow (setup, preview, run, rest-spot lookup, tick
  //     loop to completion, feedback capture, Runs screen, replay, run-log
  //     timeline) — no Maps key was entered, so the local route + synthetic
  //     rest-spot paths are exercised, never Google Maps.
  expect(externalRequests, `unexpected external requests: ${externalRequests.join(', ')}`).toHaveLength(0)
})

// ── Seam-only surfaces: no UI to drive (S9.4) ──────────────────────────────
//
// Both surfaces below are confirmed, by grepping `src/**/*.tsx` for their
// client-seam function names, to have ZERO component call sites — there is
// no button, no form, no file input anywhere in the synced UI that reaches
// them. Faking a DOM interaction here would misrepresent coverage, so they
// are left as explicit `test.skip` entries: visible in the Playwright report
// as skipped (not silently omitted), each pointing at its real unit-test
// coverage instead.

test.skip(
  'export/import round-trip — seam-only, no UI surface exists to drive (covered by tests/portability.test.ts unit suite)',
  async () => {
    // src/engine/services/portability.ts exports exportPortable/importPortable
    // (docker file-layout round-trip, incl. the sensitive-key export refusal
    // guard). Grepping src/ finds no .tsx reference to either name — no
    // Export/Import button exists in the synced presentation components
    // (app/frontend never had one either). tests/portability.test.ts drives
    // the seam directly and is part of the green `npm test` gate.
  },
)

test.skip(
  'js_module package upload — seam-only, no UI surface exists to drive (covered by tests/add_package.test.ts unit suite; uploaded-package run-integration deferred)',
  async () => {
    // src/api/client.ts exports addUserPackage(source) — the js_module
    // upload UX with smoke-on-upload gating (S9.2). Grepping src/ finds no
    // .tsx reference to it — no upload/file-input control exists in the
    // synced presentation components (controller-confirmed: the docker
    // app/frontend had no such UI either). tests/add_package.test.ts drives
    // the seam directly (good/bad manifest, non-js_module type coercion,
    // main-thread isolation) and is part of the green `npm test` gate.
    // NOT covered anywhere: actually RUNNING a package added via
    // addUserPackage through the tick loop — src/engine/algorithms/adapter.ts's
    // dispatch only wires the bundled builtin_js_module strategy (S9.3); a
    // user-uploaded js_module package cannot yet execute a tick. That
    // run-integration gap is a deferred follow-up, not this task's scope.
  },
)
