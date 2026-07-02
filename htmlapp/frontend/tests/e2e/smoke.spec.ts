import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// package.json has "type": "module", so this file runs as an ES module and
// __dirname is not defined — derive it from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * S4.4 file:// smoke test — the M-S4 shippable-artifact gate.
 *
 * SCOPE, part 1 (controller decision, see task-S4.4-report.md): both bundled
 * packages (nri_fatigue_score_v1, aica_transparent_hybrid_trigger_v1) are
 * `algorithm.type: "python_module"`, which the TS adapter
 * (src/engine/algorithms/adapter.ts) does not support until S9 — every tick
 * would raise `unsupported_algorithm_type` and pause the run by default. That
 * is expected, valid behavior, so this smoke was never going to assert a
 * completed run / an expected event count (deferred to S9.4).
 *
 * SCOPE, part 2 (discovered while implementing this task — see the "found
 * during S4.4" section of task-S4.4-report.md): `routesAnalyze` in
 * `src/api/client.ts` is STILL A STUB — `throw new Error('not implemented:
 * routesAnalyze')` — because task S7.3 ("Maps client + analyze/rest-spots
 * seam", which wires the real body) is NOT in the merged set for this branch
 * (only S7.2, the local-path *engine* port, is merged). `PlanPreview.
 * handlePreview` (frozen/copied component) unconditionally calls
 * `routesAnalyze` before a run plan can be created — on EVERY path, key or
 * no key. So today, "Preview Plan" always fails, a run plan can never be
 * drafted, and no run/tick is reachable via the UI at all. This is a step
 * earlier than the algorithm-error blocker the S9 gap above already
 * anticipated.
 *
 * What this smoke proves given that reality:
 *   1. The built dist/index.html loads over file:// and renders the app
 *      (title + Setup screen visible).
 *   2. The setup screen's package + scenario pickers are populated from the
 *      IndexedDB-seeded defaults — proving IndexedDB works on the file://
 *      origin and the local registries/seam work in the BUILT bundle (not
 *      just dev/jsdom).
 *   3. Driving Preview Plan surfaces the routesAnalyze stub failure as a
 *      clean, visible `setup-error` notice — not a silent hang or a crash.
 *      This is the deepest the setup flow can go until S7.3 lands.
 *   4. THE SELF-CONTAINMENT INVARIANT: zero unexpected external network
 *      requests. Only file://, data:, and blob: are allowed — nothing else
 *      may be fetched from a `file://`-served single-file bundle (Google
 *      Maps JS is the only permitted outbound origin, and routesAnalyze
 *      never even reaches it today).
 *
 * TODO(S7.3): once routesAnalyze is wired for the local path, extend this
 * test past step 3 to: Start Run -> Step (tick) -> assert an "Algorithm
 * Error" trace row appears (per the S9 gap above) — i.e. the original
 * create-run-and-tick assertion this task was written for.
 */

const DIST = pathToFileURL(resolve(__dirname, '..', '..', 'dist', 'index.html')).href

test('offline bundle loads over file://, seeds IndexedDB, and surfaces setup errors cleanly', async ({ page }) => {
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
  //    (PackageSelector / ScenarioSelector: native <select id="package-select">
  //    / <select id="scenario-select">, disabled until options load — waiting for
  //    "enabled" proves the async listPackages()/listScenarios() -> IndexedDB
  //    round-trip completed on the file:// origin.)
  const packageSelect = page.locator('#package-select')
  const scenarioSelect = page.locator('#scenario-select')
  await expect(packageSelect).toBeEnabled()
  await expect(scenarioSelect).toBeEnabled()

  // Select the first real option in each (index 0 is the disabled placeholder).
  await packageSelect.selectOption({ index: 1 })
  await scenarioSelect.selectOption({ index: 1 })

  // 3. Preview Plan (PlanPreview: data-testid="plan-preview"). Pre-S7.3, the
  //    local-path route resolution inside handlePreview always throws
  //    "not implemented: routesAnalyze", caught and surfaced as a
  //    data-testid="setup-error" ErrorNotice — assert that clean, visible
  //    failure mode (proves the error-handling seam works end-to-end in the
  //    built bundle, and the app never hangs or white-screens).
  await page.getByRole('button', { name: 'Preview Plan' }).click()
  await expect(page.getByTestId('setup-error')).toBeVisible()
  await expect(page.getByTestId('setup-error')).toContainText(/routesAnalyze/i)

  // No plan can be drafted yet, so "Start Run" must not have appeared.
  await expect(page.getByTestId('plan-summary')).toHaveCount(0)

  // 4. Self-containment invariant: no unexpected external requests were made.
  expect(externalRequests, `unexpected external requests: ${externalRequests.join(', ')}`).toHaveLength(0)
})
